import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { clearOrdered, markOrdered } from "@/db/reorder-writer";
import * as s from "@/db/schema";
import { receiveStock } from "@/db/stock-writer";
import { freshDemoData, testDb } from "./helpers";
import { invSetup, item } from "./inv-helpers";

const skip = !!process.env.SKIP_DB_TESTS;
const { db, pool } = testDb();
const opts = { today: "2026-11-20" };
afterAll(async () => {
  await pool.end();
});

describe.skipIf(skip)("reorder list: Ordered on (database)", () => {
  let x: Awaited<ReturnType<typeof invSetup>>;
  beforeEach(async () => {
    await freshDemoData(db);
    x = await invSetup(db);
  });

  it("sending marks the items Ordered on today and notes what was sent", async () => {
    const r = await markOrdered(db, { supplierId: x.supplier.id, method: "WHATSAPP", doneBy: x.team.id, lines: [{ itemId: x.resin.id, qty: "3000" }, { itemId: x.gloves.id, qty: "500" }] }, opts);
    expect(r).toEqual({ supplier: "Deccan Resins & Polymers", items: 2, orderedOn: "2026-11-20" });
    expect(await item(db, x.resin.id)).toMatchObject({ orderedOn: "2026-11-20", orderedSupplierId: x.supplier.id });
    const [send] = await db.select().from(s.invReorderSends);
    expect(send).toMatchObject({ supplierId: x.supplier.id, method: "WHATSAPP", doneBy: x.team.id });
    expect(send.items).toEqual([
      { itemId: x.resin.id, name: "SLA resin, imported (grey)", qty: "3000.000", unit: "ml" },
      { itemId: x.gloves.id, name: "Nitrile gloves", qty: "500.000", unit: "pcs" },
    ]);
    await expect(markOrdered(db, { supplierId: x.supplier.id, method: "PDF", lines: [{ itemId: x.gloves.id, qty: "0" }] }, opts)).rejects.toThrow("Please enter the quantity to order of Nitrile gloves.");
  });

  it("the mark clears when stock is received from that supplier (not another one), or by hand", async () => {
    await markOrdered(db, { supplierId: x.supplier.id, method: "EMAIL", lines: [{ itemId: x.gloves.id, qty: "500" }, { itemId: x.resin.id, qty: "1000" }] }, opts);
    await receiveStock(db, { supplierId: x.other.id, lines: [{ itemId: x.gloves.id, qty: "100", rate: "2" }] }, opts);
    expect((await item(db, x.gloves.id)).orderedOn).toBe("2026-11-20"); // other supplier: still ordered
    await receiveStock(db, { supplierId: x.supplier.id, lines: [{ itemId: x.gloves.id, qty: "500", rate: "2" }] }, opts);
    expect(await item(db, x.gloves.id)).toMatchObject({ orderedOn: null, orderedSupplierId: null });
    await clearOrdered(db, x.resin.id);
    expect((await item(db, x.resin.id)).orderedOn).toBeNull();
    expect(await db.select().from(s.invReorderSends).where(eq(s.invReorderSends.method, "EMAIL"))).toHaveLength(1);
  });
});
