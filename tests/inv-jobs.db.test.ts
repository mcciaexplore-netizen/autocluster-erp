import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { ticketMaterialCost } from "@/db/inv-jobs";
import { verifyInventory } from "@/db/inv-verify";
import { setServiceMaterials } from "@/db/inv-master-writer";
import * as s from "@/db/schema";
import { issueStock, receiveStock, reverseDocument } from "@/db/stock-writer";
import { changeQuotationStatus } from "@/db/ticket-writer";
import { keptAfterMaterials, suggestMaterials } from "@/lib/inventory/materials";
import { toPaise } from "@/lib/pricing";
import { freshDemoData, makeQuote, testDb, ticketsOf } from "./helpers";
import { invSetup } from "./inv-helpers";

const skip = !!process.env.SKIP_DB_TESTS;
const { db, pool } = testDb();
const opts = { today: "2026-11-20" };
afterAll(async () => {
  await pool.end();
});

describe.skipIf(skip)("materials for jobs (database)", () => {
  let x: Awaited<ReturnType<typeof invSetup>>;
  beforeEach(async () => {
    await freshDemoData(db);
    x = await invSetup(db);
  });
  afterEach(async () => {
    expect(await verifyInventory(db)).toEqual([]);
  });

  async function slaTicket() {
    const q = await makeQuote(db, "Sahyadri", [{ name: "SLA - imported resin", q: { ccPerPart: 50, parts: 4 } }]); // 200 cc
    await changeQuotationStatus(db, q.id, "ACCEPTED", "2026-11-19");
    const [t] = await ticketsOf(db, q.id);
    const [svc] = await db.select().from(s.services).where(eq(s.services.name, "SLA - imported resin"));
    return { t, svc };
  }

  it("a 200 cc SLA job: 1.15 ml per cc suggests 230 ml; recorded at ₹4.50 it costs ₹1,035 and ₹7,200 keeps ₹6,165 (85.6%)", async () => {
    const { t, svc } = await slaTicket();
    await setServiceMaterials(db, svc.id, [{ itemId: x.resin.id, qtyPerUnit: "1.15" }]);
    const [sm] = await db.select().from(s.invServiceMaterials);
    expect(sm.qtyPerUnit).toBe("1.1500");
    expect(t.snapshot.billableQty).toBe("200.000");
    const [sug] = suggestMaterials(t.snapshot.billableQty, t.snapshot.unitLabel, [{ itemId: x.resin.id, name: "SLA resin", unit: "ml", qtyPerUnit: sm.qtyPerUnit, inStock: "3000" }]);
    expect(sug.qty).toBe("230");
    await receiveStock(db, { supplierId: x.supplier.id, lines: [{ itemId: x.resin.id, qty: "3", inPacks: true, rate: "4500", ratePerPack: true, batchNo: "B1", expiryDate: "2027-06-30" }] }, opts);
    await issueStock(db, { ticketId: t.id, lines: [{ itemId: x.resin.id, qty: sug.qty }] }, opts);
    const m = await ticketMaterialCost(db, t.id);
    expect(m.costPaise).toBe(1_035_00);
    expect(toPaise(t.taxableValue)).toBe(7_200_00);
    expect(keptAfterMaterials(toPaise(t.taxableValue), m.costPaise)).toEqual({ keptPaise: 6_165_00, pct: 85.6 });
  });

  it("material cost subtracts reversals", async () => {
    const { t } = await slaTicket();
    await receiveStock(db, { supplierId: x.supplier.id, lines: [{ itemId: x.gloves.id, qty: "100", rate: "2" }] }, opts);
    await issueStock(db, { ticketId: t.id, lines: [{ itemId: x.gloves.id, qty: "10" }] }, opts);
    const second = await issueStock(db, { ticketId: t.id, lines: [{ itemId: x.gloves.id, qty: "4" }] }, opts);
    expect((await ticketMaterialCost(db, t.id)).costPaise).toBe(28_00);
    await reverseDocument(db, second.id, "Entered twice", opts);
    const m = await ticketMaterialCost(db, t.id);
    expect(m.costPaise).toBe(20_00);
    expect(m.items).toEqual([{ itemId: x.gloves.id, name: "Nitrile gloves", unit: "pcs", qty: "10.000", valuePaise: 20_00 }]);
    expect(m.docs).toHaveLength(3);
  });

  it("materials lists: no duplicates, positive amounts, cleared with an empty list; cancelled jobs can't take stock", async () => {
    const { t, svc } = await slaTicket();
    await expect(setServiceMaterials(db, svc.id, [{ itemId: x.resin.id, qtyPerUnit: "1" }, { itemId: x.resin.id, qtyPerUnit: "2" }])).rejects.toThrow(/already in the list/);
    await expect(setServiceMaterials(db, svc.id, [{ itemId: x.resin.id, qtyPerUnit: "0" }])).rejects.toThrow(/per billing unit/);
    await setServiceMaterials(db, svc.id, [{ itemId: x.resin.id, qtyPerUnit: "1.15" }, { itemId: x.gloves.id, qtyPerUnit: "0.02" }]);
    expect(await db.select().from(s.invServiceMaterials)).toHaveLength(2);
    await setServiceMaterials(db, svc.id, []);
    expect(await db.select().from(s.invServiceMaterials)).toHaveLength(0);
    await db.update(s.tickets).set({ stage: "CANCELLED" }).where(eq(s.tickets.id, t.id));
    await expect(issueStock(db, { ticketId: t.id, lines: [{ itemId: x.gloves.id, qty: "1" }] }, opts)).rejects.toThrow(/cancelled/);
  });
});
