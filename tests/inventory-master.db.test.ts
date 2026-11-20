import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { addListItem, deleteListItem } from "@/db/crm-lists-writer";
import { ensureInventoryDefaults } from "@/db/inv-defaults";
import { createItem, createSupplier, previewItemCode, updateItem, updateSupplier } from "@/db/inv-master-writer";
import * as s from "@/db/schema";
import { EMPTY_ITEM_FORM, EMPTY_SUPPLIER_FORM, type ItemFormValues } from "@/lib/validation/inventory";
import { freshDemoData, testDb } from "./helpers";

const skip = !!process.env.SKIP_DB_TESTS;
const { db, pool } = testDb();

async function base(): Promise<ItemFormValues> {
  const [cat] = await db.select().from(s.invCategories).where(eq(s.invCategories.name, "Raw material"));
  const [unit] = await db.select().from(s.invUnits).where(eq(s.invUnits.name, "ml"));
  return { ...EMPTY_ITEM_FORM, name: "SLA resin, imported (grey)", categoryId: cat.id, unitId: unit.id, reorderLevel: "1000", reorderQty: "3000", packName: "Bottle", packSize: "1000", deptCodes: ["RPT"] };
}

describe.skipIf(skip)("inventory items and suppliers (database)", () => {
  beforeEach(async () => {
    await freshDemoData(db);
  });
  afterAll(async () => {
    await pool.end();
  });

  it("the default lists are there, and adding them again changes nothing", async () => {
    expect((await db.select().from(s.invUnits)).map((u) => u.name)).toEqual(["ml", "L", "g", "kg", "pcs", "m", "set", "cylinder", "box"]);
    expect(await db.select().from(s.invCategories)).toHaveLength(5);
    expect(await db.select().from(s.invPurposes)).toHaveLength(5);
    expect(await db.select().from(s.invAdjustReasons)).toHaveLength(6);
    expect(await ensureInventoryDefaults(db)).toEqual([]);
  });

  it("item codes: next number by default, own codes kept, no duplicates", async () => {
    expect(await previewItemCode(db)).toBe("ITM-0001");
    const a = await createItem(db, await base(), { suggestedCode: "ITM-0001" });
    expect(a).toMatchObject({ code: "ITM-0001", qtyOnHand: "0.000", avgCost: "0.0000", packSize: "1000.000" });
    const b = await createItem(db, { ...(await base()), name: "IPA", code: "rpt-ipa" });
    expect(b.code).toBe("RPT-IPA");
    await expect(createItem(db, { ...(await base()), name: "Other", code: "RPT-IPA" })).rejects.toThrow(/already used/);
    await expect(createItem(db, { ...(await base()), name: "sla resin, imported (GREY)" })).rejects.toThrow(/already an item/);
    // a hand-typed code that matches the next number is skipped
    await createItem(db, { ...(await base()), name: "Hand typed", code: "ITM-0002" });
    expect((await createItem(db, { ...(await base()), name: "Auto" })).code).toBe("ITM-0003");
    expect(await db.select().from(s.invItemDepartments).where(eq(s.invItemDepartments.itemId, a.id))).toEqual([{ itemId: a.id, deptCode: "RPT" }]);
  });

  it("the unit and batch tracking can't change while there is stock", async () => {
    const v = await base();
    const a = await createItem(db, v);
    const [litre] = await db.select().from(s.invUnits).where(eq(s.invUnits.name, "L"));
    await updateItem(db, a.id, { ...v, unitId: litre.id, trackBatches: true }); // no stock yet: fine
    await db.update(s.invItems).set({ qtyOnHand: "10" }).where(eq(s.invItems.id, a.id));
    await expect(updateItem(db, a.id, { ...v, unitId: v.unitId, trackBatches: true })).rejects.toThrow(/unit can't be changed/);
    await expect(updateItem(db, a.id, { ...v, unitId: litre.id, trackBatches: false })).rejects.toThrow(/Batch tracking can't be turned off/);
  });

  it("suppliers: unique names, mobile tidied, GSTIN upper case", async () => {
    const sup = await createSupplier(db, { ...EMPTY_SUPPLIER_FORM, name: "Deccan Resins & Polymers", phone: "+91 98220 11111", gstin: "27aabcd1234e1z5" });
    expect(sup).toMatchObject({ phone: "9822011111", gstin: "27AABCD1234E1Z5" });
    await expect(createSupplier(db, { ...EMPTY_SUPPLIER_FORM, name: "deccan resins & polymers" })).rejects.toThrow(/already a supplier/);
    await updateSupplier(db, sup.id, { ...EMPTY_SUPPLIER_FORM, name: "Deccan Resins & Polymers", contactName: "Mr. Kale" });
    expect((await db.select().from(s.invSuppliers).where(eq(s.invSuppliers.id, sup.id)))[0].contactName).toBe("Mr. Kale");
  });

  it("a unit used by an item is hidden instead of deleted", async () => {
    const id = await addListItem(db, "invUnits", { name: "roll" });
    expect(await deleteListItem(db, "invUnits", id)).toBe("deleted");
    const v = await base();
    await createItem(db, v);
    expect(await deleteListItem(db, "invUnits", v.unitId)).toBe("hidden");
  });
});
