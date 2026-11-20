import { asc, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { discardCount, saveCountLine, startCount } from "@/db/count-writer";
import { verifyInventory } from "@/db/inv-verify";
import * as s from "@/db/schema";
import { adjustStock, completeCount, issueStock, receiveStock } from "@/db/stock-writer";
import { freshDemoData, testDb } from "./helpers";
import { invSetup, item } from "./inv-helpers";

const skip = !!process.env.SKIP_DB_TESTS;
const { db, pool } = testDb();
const TODAY = "2026-11-20";
const opts = { today: TODAY };
afterAll(async () => {
  await pool.end();
});

describe.skipIf(skip)("stock count (database)", () => {
  let x: Awaited<ReturnType<typeof invSetup>>;
  beforeEach(async () => {
    await freshDemoData(db);
    x = await invSetup(db);
    // Resin: two batches (1,000 ml at ₹4 + 1,000 ml at ₹5 = 2,000 ml at ₹4.50). Gloves: 150 pcs at ₹2.
    await receiveStock(
      db,
      {
        supplierId: x.supplier.id,
        lines: [
          { itemId: x.resin.id, qty: "1000", rate: "4", batchNo: "A1", expiryDate: "2027-06-30" },
          { itemId: x.resin.id, qty: "1000", rate: "5", batchNo: "A2", expiryDate: "2027-08-31" },
          { itemId: x.gloves.id, qty: "150", rate: "2" },
        ],
      },
      opts,
    );
  });
  afterEach(async () => {
    expect(await verifyInventory(db)).toEqual([]);
  });

  const lines = async (countId: string) => {
    const rows = await db.select().from(s.invCountLines).where(eq(s.invCountLines.countId, countId)).orderBy(asc(s.invCountLines.id));
    const batches = await db.select().from(s.invBatches);
    return rows.map((r) => ({ ...r, batchNo: batches.find((b) => b.id === r.batchId)?.batchNo ?? null }));
  };

  it("freezes quantities batch by batch, and completing makes one Stock count adjustment and locks the count", async () => {
    const c = await startCount(db, { doneBy: x.team.id }, opts);
    expect(c.countNo).toBe("ACDRI/CNT/2026-27/0001");
    const ls = await lines(c.id);
    // resin is counted per batch; gloves as one line
    expect(ls.map((l) => [l.batchNo, l.systemQty])).toEqual(expect.arrayContaining([["A1", "1000.000"], ["A2", "1000.000"], [null, "150.000"]]));
    expect(ls).toHaveLength(3);

    // only one count open at a time
    await expect(startCount(db, {}, opts)).rejects.toThrow(/is still open/);

    const a1 = ls.find((l) => l.batchNo === "A1")!;
    const a2 = ls.find((l) => l.batchNo === "A2")!;
    const gl = ls.find((l) => l.itemId === x.gloves.id)!;
    await saveCountLine(db, a1.id, "940"); // 60 ml short
    await saveCountLine(db, a2.id, "1000"); // matches
    await saveCountLine(db, gl.id, "155"); // 5 found
    await expect(saveCountLine(db, gl.id, "-1")).rejects.toThrow(/0 or more/);

    const r = await completeCount(db, c.id, { doneBy: x.team.id, today: TODAY });
    expect(r).toMatchObject({ changes: 2, adjustment: { docNo: "ACDRI/ADJ/2026-27/0001" } });

    const [doc] = await db.select().from(s.invDocuments).where(eq(s.invDocuments.id, r.adjustment!.id));
    expect(doc).toMatchObject({ type: "ADJ", note: "Stock count 20/11/2026 (ACDRI/CNT/2026-27/0001)", docDate: TODAY });
    const mvs = await db.select().from(s.invMovements).where(eq(s.invMovements.documentId, doc.id)).orderBy(asc(s.invMovements.id));
    expect(mvs).toHaveLength(2);
    expect(mvs.map((m) => [m.itemId, m.batchId, m.qtyIn, m.qtyOut, m.value])).toEqual(expect.arrayContaining([
      [x.resin.id, a1.batchId, "0.000", "60.000", 270_00], // 60 ml x ₹4.50
      [x.gloves.id, null, "5.000", "0.000", 10_00], // 5 pcs x ₹2, the average doesn't change
    ]));
    expect(await item(db, x.resin.id)).toMatchObject({ qtyOnHand: "1940.000", avgCost: "4.5000" });
    expect(await item(db, x.gloves.id)).toMatchObject({ qtyOnHand: "155.000", avgCost: "2.0000" });
    const [b1] = await db.select().from(s.invBatches).where(eq(s.invBatches.id, a1.batchId!));
    expect(b1.qtyOnHand).toBe("940.000");

    // locked
    const [cnt] = await db.select().from(s.invCounts).where(eq(s.invCounts.id, c.id));
    expect(cnt).toMatchObject({ status: "COMPLETED", adjustmentDocId: doc.id });
    await expect(saveCountLine(db, gl.id, "150")).rejects.toThrow(/complete and can't be changed/);
    await expect(completeCount(db, c.id, opts)).rejects.toThrow(/already complete/);
    await expect(discardCount(db, c.id)).rejects.toThrow(/can't be discarded/);
    // a new count can start now
    await expect(startCount(db, {}, opts)).resolves.toMatchObject({ countNo: "ACDRI/CNT/2026-27/0002" });
  });

  it("stock that moves during the count is allowed for: counted is compared with the frozen quantity ± movements since", async () => {
    const c = await startCount(db, {}, opts);
    const gl = (await lines(c.id)).find((l) => l.itemId === x.gloves.id)!;
    expect(gl.systemQty).toBe("150.000");
    // 30 gloves used after the count started; 120 are on the shelf and counted
    await issueStock(db, { purposeId: x.purpose("Training"), lines: [{ itemId: x.gloves.id, qty: "30" }] }, opts);
    await saveCountLine(db, gl.id, "120");
    const r = await completeCount(db, c.id, opts);
    expect(r).toMatchObject({ changes: 0, adjustment: null });
    expect((await item(db, x.gloves.id)).qtyOnHand).toBe("120.000");
    expect((await db.select().from(s.invDocuments).where(eq(s.invDocuments.type, "ADJ")))).toHaveLength(0);
  });

  it("lines not counted are left alone; nothing counted is refused; discarding changes nothing", async () => {
    const c = await startCount(db, {}, opts);
    await expect(completeCount(db, c.id, opts)).rejects.toThrow(/count at least one item/);
    const gl = (await lines(c.id)).find((l) => l.itemId === x.gloves.id)!;
    await saveCountLine(db, gl.id, "140");
    await saveCountLine(db, gl.id, ""); // cleared again
    await saveCountLine(db, gl.id, "140");
    const r = await completeCount(db, c.id, opts);
    expect(r.changes).toBe(1);
    expect(await item(db, x.resin.id)).toMatchObject({ qtyOnHand: "2000.000" }); // resin wasn't counted
    expect((await item(db, x.gloves.id)).qtyOnHand).toBe("140.000");

    const c2 = await startCount(db, {}, opts);
    await saveCountLine(db, (await lines(c2.id))[0].id, "1");
    await discardCount(db, c2.id);
    expect(await db.select().from(s.invCounts).where(eq(s.invCounts.id, c2.id))).toHaveLength(0);
    expect((await item(db, x.gloves.id)).qtyOnHand).toBe("140.000");
  });

  it("counts by category; found stock of an item with no average cost is refused with a plain message", async () => {
    const [cons] = await db.select().from(s.invCategories).where(eq(s.invCategories.name, "Consumable"));
    const [pcs] = await db.select().from(s.invUnits).where(eq(s.invUnits.name, "pcs"));
    const [tape] = await db.insert(s.invItems).values({ code: "ITM-9001", name: "Masking tape", categoryId: cons.id, unitId: pcs.id }).returning();
    const c = await startCount(db, { categoryId: cons.id }, opts);
    const ls = await lines(c.id);
    expect(ls.map((l) => l.itemId)).toEqual([tape.id]);
    await saveCountLine(db, ls[0].id, "4");
    await expect(completeCount(db, c.id, opts)).rejects.toThrow("Masking tape has no average cost yet, so the extra 4 pcs can't be valued. Add it with Adjust stock > Opening stock (with a rate), then count it here again.");
    // after adding it as opening stock, the count matches
    await adjustStock(db, { note: "Found during count", lines: [{ itemId: tape.id, direction: "ADD", qty: "4", opening: true, unitCost: "30" }] }, opts);
    await expect(completeCount(db, c.id, opts)).resolves.toMatchObject({ changes: 0 });
  });
});
