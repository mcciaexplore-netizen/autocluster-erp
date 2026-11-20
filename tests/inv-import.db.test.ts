import ExcelJS from "exceljs";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { importItems } from "@/db/inv-import-writer";
import { verifyInventory } from "@/db/inv-verify";
import * as s from "@/db/schema";
import { itemImportTemplate, readItemImportFile } from "@/lib/inventory/excel";
import { checkItemRows, ITEM_IMPORT_COLUMNS, type ItemImportLists } from "@/lib/inventory/import";
import { freshDemoData, testDb } from "./helpers";
import { invSetup } from "./inv-helpers";

const skip = !!process.env.SKIP_DB_TESTS;
const { db, pool } = testDb();
afterAll(async () => {
  await pool.end();
});

async function lists(): Promise<ItemImportLists> {
  const [categories, units, suppliers, departments, items] = await Promise.all([
    db.select({ id: s.invCategories.id, name: s.invCategories.name }).from(s.invCategories),
    db.select({ id: s.invUnits.id, name: s.invUnits.name }).from(s.invUnits),
    db.select({ id: s.invSuppliers.id, name: s.invSuppliers.name }).from(s.invSuppliers),
    db.select({ code: s.departments.code, name: s.departments.name }).from(s.departments),
    db.select({ name: s.invItems.name, code: s.invItems.code }).from(s.invItems),
  ]);
  return { categories, units, suppliers, departments, existingNames: new Set(items.map((i) => i.name.toLowerCase())), existingCodes: new Set(items.map((i) => i.code)) };
}

describe.skipIf(skip)("import items from Excel (database)", () => {
  beforeEach(async () => {
    await freshDemoData(db);
    await invSetup(db);
  });

  it("template -> filled file -> checked rows -> items plus one Opening stock record", async () => {
    const l = await lists();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await itemImportTemplate(l)).buffer as ArrayBuffer);
    const ws = wb.getWorksheet("Items")!;
    const col = (k: string) => ITEM_IMPORT_COLUMNS.findIndex((c) => c.key === k) + 1;
    const put = (row: number, v: Record<string, string>) => Object.entries(v).forEach(([k, x]) => (ws.getCell(row, col(k)).value = x));
    put(3, { name: "PA12 powder", category: "Raw material", unit: "kg", reorderLevel: "20", reorderQty: "50", trackBatches: "Yes", departments: "RPT", supplier: "Deccan Resins & Polymers", openingQty: "35.5", openingRate: "4200", batchNo: "PA-2610", expiryDate: "30/06/2027" });
    put(4, { name: "Isopropyl alcohol", category: "Lab chemical", unit: "L", reorderLevel: "5", reorderQty: "20", openingQty: "12", openingRate: "180" });
    put(5, { name: "Masking tape", category: "Consumable", unit: "pcs", reorderLevel: "10", reorderQty: "50" });
    put(6, { name: "Nitrile gloves", category: "Consumable", unit: "pcs", reorderLevel: "10", reorderQty: "50" }); // already exists
    put(7, { name: "PA12 powder", openingQty: "10", openingRate: "4400", batchNo: "PA-2611", expiryDate: "31/07/2027" }); // second batch
    const { rows, skippedExample } = await readItemImportFile(new Uint8Array(await wb.xlsx.writeBuffer()));
    expect(skippedExample).toBe(true);
    const checked = checkItemRows(rows, l);
    expect(checked.map((c) => [c.rowNo, !!c.input, c.addsTo, c.problems.length])).toEqual([[3, true, null, 0], [4, true, null, 0], [5, true, null, 0], [6, false, null, 1], [7, false, 3, 0]]);
    expect(checked[3].problems).toEqual(["Row 6: there is already an item called “Nitrile gloves”."]);

    const good = checked.filter((c) => !c.problems.length);
    const r = await importItems(db, good.map((c) => ({ rowNo: c.rowNo, input: c.input, addsTo: c.addsTo, opening: c.opening })), "items.xlsx", { today: "2026-11-20" });
    expect(r.items.map((i) => i.name)).toEqual(["PA12 powder", "Isopropyl alcohol", "Masking tape"]);
    expect(r.openingDoc?.docNo).toBe("ACDRI/ADJ/2026-27/0001");
    const mvs = await db.select().from(s.invMovements).orderBy(asc(s.invMovements.id));
    expect(mvs.map((m) => [m.qtyIn, m.unitCost, m.value, m.isOpening])).toEqual([
      ["35.500", "4200.0000", 149_100_00, true],
      ["12.000", "180.0000", 2_160_00, true],
      ["10.000", "4400.0000", 44_000_00, true],
    ]);
    const [pa] = await db.select().from(s.invItems).where(eq(s.invItems.name, "PA12 powder"));
    expect(pa).toMatchObject({ qtyOnHand: "45.500", avgCost: "4243.9560", trackBatches: true });
    const bs = await db.select().from(s.invBatches).where(eq(s.invBatches.itemId, pa.id)).orderBy(asc(s.invBatches.batchNo));
    expect(bs.map((b) => [b.batchNo, b.expiryDate, b.qtyOnHand])).toEqual([["PA-2610", "2027-06-30", "35.500"], ["PA-2611", "2027-07-31", "10.000"]]);
    const [doc] = await db.select().from(s.invDocuments).where(eq(s.invDocuments.id, r.openingDoc!.id));
    expect(doc.note).toBe("Opening stock imported from Excel (items.xlsx)");
    expect(await verifyInventory(db)).toEqual([]);
  });
});
