import { asc, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyInventory } from "@/db/inv-verify";
import * as s from "@/db/schema";
import { adjustStock, receiveStock, reverseDocument, issueStock } from "@/db/stock-writer";
import { freshDemoData, testDb } from "./helpers";
import { invSetup, item } from "./inv-helpers";

const skip = !!process.env.SKIP_DB_TESTS;
const { db, pool } = testDb();
const TODAY = "2026-11-20";
const opts = { today: TODAY };

describe.skipIf(skip)("stock engine (database)", () => {
  let x: Awaited<ReturnType<typeof invSetup>>;
  beforeEach(async () => {
    await freshDemoData(db);
    x = await invSetup(db);
  });
  afterEach(async () => {
    // Stored stock must always match the movements.
    expect(await verifyInventory(db)).toEqual([]);
  });
  afterAll(async () => {
    await pool.end();
  });

  it("average cost: 1,000 ml at ₹4 + 1,000 ml at ₹5 = ₹4.50; using 500 ml is valued ₹2,250, leaving 1,500 ml at ₹4.50", async () => {
    await receiveStock(db, { supplierId: x.supplier.id, lines: [{ itemId: x.resin.id, qty: "1000", rate: "4", batchNo: "A1", expiryDate: "2027-06-30" }] }, opts);
    const r2 = await receiveStock(db, { supplierId: x.supplier.id, supplierBillNo: "DRP/889", lines: [{ itemId: x.resin.id, qty: "1000", rate: "5", batchNo: "A2", expiryDate: "2027-08-31" }] }, opts);
    expect(r2.docNo).toBe("ACDRI/IN/2026-27/0002");
    expect(await item(db, x.resin.id)).toMatchObject({ qtyOnHand: "2000.000", avgCost: "4.5000", lastPurchaseRate: "5.0000" });
    const u = await issueStock(db, { purposeId: x.purpose("Trial run"), lines: [{ itemId: x.resin.id, qty: "500" }] }, opts);
    expect(u).toMatchObject({ docNo: "ACDRI/OUT/2026-27/0001", valuePaise: 2_250_00 });
    expect(await item(db, x.resin.id)).toMatchObject({ qtyOnHand: "1500.000", avgCost: "4.5000" });
    const [si] = await db.select().from(s.invSupplierItems).where(eq(s.invSupplierItems.itemId, x.resin.id));
    expect(si).toMatchObject({ lastRate: "5.0000", lastRateDate: TODAY });
  });

  it("packs: 3 bottles of 1,000 ml at ₹4,500 per bottle = 3,000 ml at ₹4.50 per ml", async () => {
    await receiveStock(db, { supplierId: x.supplier.id, lines: [{ itemId: x.resin.id, qty: "3", inPacks: true, rate: "4500", ratePerPack: true, batchNo: "B1", expiryDate: "2027-05-31" }] }, opts);
    expect(await item(db, x.resin.id)).toMatchObject({ qtyOnHand: "3000.000", avgCost: "4.5000" });
    const [mv] = await db.select().from(s.invMovements);
    expect(mv).toMatchObject({ qtyIn: "3000.000", unitCost: "4.5000", value: 13_500_00, balanceAfter: "3000.000" });
  });

  it("no negative stock: using more than in stock is refused with a plain message", async () => {
    await receiveStock(db, { supplierId: x.supplier.id, lines: [{ itemId: x.gloves.id, qty: "150", rate: "2" }] }, opts);
    await expect(issueStock(db, { purposeId: x.purpose("Training"), lines: [{ itemId: x.gloves.id, qty: "230" }] }, opts)).rejects.toThrow("Only 150 pcs of Nitrile gloves in stock. You entered 230 pcs.");
    // two lines of the same item are added together
    await expect(issueStock(db, { purposeId: x.purpose("Training"), lines: [{ itemId: x.gloves.id, qty: "100" }, { itemId: x.gloves.id, qty: "60" }] }, opts)).rejects.toThrow(/Only 150 pcs/);
    expect((await item(db, x.gloves.id)).qtyOnHand).toBe("150.000");
    expect(await db.select().from(s.invDocuments).where(eq(s.invDocuments.type, "OUT"))).toHaveLength(0);
  });

  it("10 uses of the same item saved at the same moment never take stock below zero", async () => {
    await receiveStock(db, { supplierId: x.supplier.id, lines: [{ itemId: x.gloves.id, qty: "50", rate: "2" }] }, opts);
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => issueStock(db, { purposeId: x.purpose("Training"), lines: [{ itemId: x.gloves.id, qty: "8" }] }, opts)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(6); // 6 x 8 = 48
    expect((await item(db, x.gloves.id)).qtyOnHand).toBe("2.000");
    const nos = (await db.select().from(s.invDocuments).where(eq(s.invDocuments.type, "OUT"))).map((d) => d.docNo);
    expect(new Set(nos).size).toBe(6);
  });

  it("batches: use takes the batch that expires first; expired batches are never used", async () => {
    await receiveStock(
      db,
      {
        supplierId: x.supplier.id,
        lines: [
          { itemId: x.resin.id, qty: "500", rate: "4", batchNo: "LATE", expiryDate: "2027-09-30" },
          { itemId: x.resin.id, qty: "300", rate: "4", batchNo: "SOON", expiryDate: "2026-12-15" },
          { itemId: x.resin.id, qty: "200", rate: "4", batchNo: "OLD", expiryDate: "2026-11-25" },
        ],
      },
      { today: "2026-11-01" },
    );
    // On 20 Nov, OLD (25 Nov) is still fine and goes first; then SOON.
    await issueStock(db, { purposeId: x.purpose("R&D"), lines: [{ itemId: x.resin.id, qty: "350" }] }, opts);
    const byNo = async () => Object.fromEntries((await db.select().from(s.invBatches)).map((b) => [b.batchNo, b.qtyOnHand]));
    expect(await byNo()).toEqual({ OLD: "0.000", SOON: "150.000", LATE: "500.000" });
    // On 20 Dec, SOON has expired: only LATE can be used.
    await expect(issueStock(db, { purposeId: x.purpose("R&D"), lines: [{ itemId: x.resin.id, qty: "600" }] }, { today: "2026-12-20" })).rejects.toThrow(
      "Only 500 ml of SLA resin, imported (grey) can be used. You entered 600 ml. 1 expired batch, adjust it out instead.",
    );
    const [soon] = await db.select().from(s.invBatches).where(eq(s.invBatches.batchNo, "SOON"));
    await expect(issueStock(db, { purposeId: x.purpose("R&D"), lines: [{ itemId: x.resin.id, qty: "10", batchId: soon.id }] }, { today: "2026-12-20" })).rejects.toThrow(/has expired/);
    // Removing the expired batch is the normal write-off.
    await adjustStock(db, { note: "Expired batch written off", lines: [{ itemId: x.resin.id, direction: "REMOVE", qty: "150", reasonId: x.reason("Expired"), batchId: soon.id }] }, { today: "2026-12-20" });
    expect(await byNo()).toEqual({ OLD: "0.000", SOON: "0.000", LATE: "500.000" });
  });

  it("batch rules on receipt: batch and expiry are required, and a batch keeps one expiry", async () => {
    await expect(receiveStock(db, { supplierId: x.supplier.id, lines: [{ itemId: x.resin.id, qty: "1", rate: "4" }] }, opts)).rejects.toThrow(/batch number/);
    await expect(receiveStock(db, { supplierId: x.supplier.id, lines: [{ itemId: x.resin.id, qty: "1", rate: "4", batchNo: "Z" }] }, opts)).rejects.toThrow(/expiry date/);
    await receiveStock(db, { supplierId: x.supplier.id, lines: [{ itemId: x.resin.id, qty: "1", rate: "4", batchNo: "Z", expiryDate: "2027-01-31" }] }, opts);
    await expect(receiveStock(db, { supplierId: x.supplier.id, lines: [{ itemId: x.resin.id, qty: "1", rate: "4", batchNo: "z", expiryDate: "2027-02-28" }] }, opts)).rejects.toThrow(/already in stock with expiry/);
    await receiveStock(db, { supplierId: x.supplier.id, lines: [{ itemId: x.resin.id, qty: "2", rate: "4", batchNo: "Z", expiryDate: "2027-01-31" }] }, opts);
    expect((await db.select().from(s.invBatches))[0].qtyOnHand).toBe("3.000");
    await expect(receiveStock(db, { supplierId: x.supplier.id, supplierBillDate: "2026-11-21", lines: [{ itemId: x.gloves.id, qty: "1", rate: "1" }] }, opts)).rejects.toThrow(/future/);
  });

  it("reversal restores stock and value exactly; a reversed record can't be reversed again", async () => {
    await receiveStock(db, { supplierId: x.supplier.id, lines: [{ itemId: x.gloves.id, qty: "1000", rate: "4" }] }, opts);
    const before = await item(db, x.gloves.id);
    const r = await receiveStock(db, { supplierId: x.supplier.id, lines: [{ itemId: x.gloves.id, qty: "1000", rate: "5" }] }, opts);
    const rev = await reverseDocument(db, r.id, "Wrong rate entered", opts);
    expect(rev).toMatchObject({ docNo: "ACDRI/IN/2026-27/0003", reversed: "ACDRI/IN/2026-27/0002" });
    const after = await item(db, x.gloves.id);
    expect({ q: after.qtyOnHand, a: after.avgCost }).toEqual({ q: before.qtyOnHand, a: before.avgCost });
    await expect(reverseDocument(db, r.id, "Again", opts)).rejects.toThrow(/already been reversed/);
    await expect(reverseDocument(db, rev.id, "Undo the undo", opts)).rejects.toThrow(/itself a reversal/);
    // Reversing a use puts it back at the value it went out at.
    const u = await issueStock(db, { purposeId: x.purpose("Training"), lines: [{ itemId: x.gloves.id, qty: "300" }] }, opts);
    await reverseDocument(db, u.id, "Entered twice", opts);
    const back = await item(db, x.gloves.id);
    expect({ q: back.qtyOnHand, a: back.avgCost }).toEqual({ q: before.qtyOnHand, a: before.avgCost });
    const [orig] = await db.select().from(s.invDocuments).where(eq(s.invDocuments.id, r.id));
    expect(orig.reversedByDocId).toBe(rev.id);
  });

  it("a delivery that has partly been used can't be reversed", async () => {
    const r = await receiveStock(db, { supplierId: x.supplier.id, lines: [{ itemId: x.gloves.id, qty: "100", rate: "2" }] }, opts);
    await issueStock(db, { purposeId: x.purpose("Training"), lines: [{ itemId: x.gloves.id, qty: "30" }] }, opts);
    await expect(reverseDocument(db, r.id, "Wrong", opts)).rejects.toThrow(/already been used/);
  });

  it("adjust: found stock is added at the average cost; a note and a reason are required", async () => {
    await receiveStock(db, { supplierId: x.supplier.id, lines: [{ itemId: x.gloves.id, qty: "100", rate: "2.5" }] }, opts);
    await expect(adjustStock(db, { note: "", lines: [{ itemId: x.gloves.id, direction: "ADD", qty: "5", reasonId: x.reason("Found extra") }] }, opts)).rejects.toThrow(/note/);
    await adjustStock(db, { note: "Box found in RPT lab", lines: [{ itemId: x.gloves.id, direction: "ADD", qty: "20", reasonId: x.reason("Found extra") }] }, opts);
    expect(await item(db, x.gloves.id)).toMatchObject({ qtyOnHand: "120.000", avgCost: "2.5000" });
    await expect(adjustStock(db, { note: "Torn", lines: [{ itemId: x.gloves.id, direction: "REMOVE", qty: "121", reasonId: x.reason("Damaged") }] }, opts)).rejects.toThrow(/Only 120 pcs/);
  });

  it("an 'Ordered on' marker clears when stock arrives from that supplier, not another", async () => {
    await db.update(s.invItems).set({ orderedOn: "2026-11-18", orderedSupplierId: x.supplier.id }).where(eq(s.invItems.id, x.gloves.id));
    await receiveStock(db, { supplierId: x.other.id, lines: [{ itemId: x.gloves.id, qty: "10", rate: "2" }] }, opts);
    expect((await item(db, x.gloves.id)).orderedOn).toBe("2026-11-18");
    await receiveStock(db, { supplierId: x.supplier.id, lines: [{ itemId: x.gloves.id, qty: "10", rate: "2" }] }, opts);
    expect(await item(db, x.gloves.id)).toMatchObject({ orderedOn: null, orderedSupplierId: null });
  });

  it("internal use 'Other' needs a note; running balances follow each line", async () => {
    await receiveStock(db, { supplierId: x.supplier.id, lines: [{ itemId: x.gloves.id, qty: "100", rate: "2" }] }, opts);
    await expect(issueStock(db, { purposeId: x.purpose("Other"), lines: [{ itemId: x.gloves.id, qty: "1" }] }, opts)).rejects.toThrow(/short note/);
    await issueStock(db, { purposeId: x.purpose("Other"), note: "Visitors' demo", lines: [{ itemId: x.gloves.id, qty: "10" }, { itemId: x.gloves.id, qty: "5" }] }, opts);
    const bal = (await db.select().from(s.invMovements).orderBy(asc(s.invMovements.id))).map((m) => m.balanceAfter);
    expect(bal).toEqual(["100.000", "90.000", "85.000"]);
  });
});
