import { and, eq, isNotNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyInventory } from "@/db/inv-verify";
import * as s from "@/db/schema";
import { deliveryLate } from "@/lib/inventory/calc";
import { isSlowMoving, priceRise } from "@/lib/inventory/insights-calc";
import { toPaise } from "@/lib/pricing";
import { addDays, daysBetween, todayInIndia } from "@/lib/tickets";
import { loadDemoData, wipe } from "@/scripts/demo-data";
import { testDb } from "./helpers";

const skip = !!process.env.SKIP_DB_TESTS;
const { db, pool } = testDb();

describe.skipIf(skip)("inventory demo data (database)", () => {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const today = todayInIndia();
  beforeAll(async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN; // never upload from tests
    await db.transaction(async (tx) => {
      await wipe(tx);
      await loadDemoData(tx, { quiet: true, orders: { blobFolder: "local" }, crm: true, inventory: true });
    });
  }, 300_000);
  afterAll(async () => {
    if (token) process.env.BLOB_READ_WRITE_TOKEN = token;
    await pool.end();
  });

  const items = () => db.select().from(s.invItems);

  it("stock matches every movement (inv:verify), and receipts always came before use", async () => {
    expect(await verifyInventory(db)).toEqual([]);
    const neg = await db.execute(sql`select 1 from inv_movements where balance_after < 0`);
    expect(neg.rows).toHaveLength(0);
  });

  it("4 suppliers, about 25 items, materials lists, and 41 past jobs paid with materials recorded", async () => {
    expect(await db.select().from(s.invSuppliers)).toHaveLength(4);
    expect((await items()).length).toBeGreaterThanOrEqual(25);
    expect((await db.execute(sql`select distinct service_id from inv_service_materials`)).rows.length).toBe(15);
    const jobs = await db.execute<{ n: string }>(sql`select count(distinct d.ticket_id) as n from inv_documents d join tickets t on t.id = d.ticket_id where t.stage = 'PAID'`);
    expect(Number(jobs.rows[0].n)).toBeGreaterThanOrEqual(40);
    // spread over the last 6 months, none in the future
    const span = await db.execute<{ first: string; last: string }>(sql`select min(doc_date)::text as first, max(doc_date)::text as last from inv_documents`);
    expect(daysBetween(span.rows[0].first, today)).toBeGreaterThanOrEqual(175);
    expect(span.rows[0].last <= today).toBe(true);
  });

  it("the story quotations come last: Sahyadri SLA (QT 0042) and Western Drive (QT 0043) are Sent", async () => {
    const qs = await db.select().from(s.quotations).where(eq(s.quotations.status, "SENT"));
    const by = (name: string) => qs.find((q) => q.customerSnapshot.companyName.startsWith(name))!;
    expect(by("Sahyadri").quoteNo).toBe("DMC/QT/2026-27/0042");
    expect(toPaise(by("Sahyadri").grandTotal)).toBe(8_496_00);
    expect(by("Western").quoteNo).toBe("DMC/QT/2026-27/0043");
    const [link] = await db.select({ q: s.quotations.quoteNo }).from(s.quotations).innerJoin(s.leads, eq(s.leads.id, s.quotations.leadId)).where(eq(s.quotations.status, "SENT"));
    expect(link.q).toBe("DMC/QT/2026-27/0043");
  });

  it("situations: 3 below the reorder level, 1 out of stock, 2 ordered (one late)", async () => {
    const all = await items();
    const below = all.filter((i) => Number(i.qtyOnHand) > 0 && Number(i.qtyOnHand) <= Number(i.reorderLevel));
    const out = all.filter((i) => Number(i.qtyOnHand) <= 0);
    expect(below.map((i) => i.name).sort()).toEqual(["Carbide end mill, 6 mm", "Coolant (soluble oil)", "Nitrile gloves"]);
    expect(out.map((i) => i.name)).toEqual(["Nitrogen gas cylinder"]);
    const ordered = all.filter((i) => i.orderedOn);
    expect(ordered.map((i) => i.name).sort()).toEqual(["Carbide end mill, 6 mm", "Nitrogen gas cylinder"]);
    expect(ordered.filter((i) => deliveryLate(i.orderedOn, i.leadTimeDays, today)).map((i) => i.name)).toEqual(["Nitrogen gas cylinder"]);
  });

  it("2 batches expiring within 30 days, 1 expired batch still in stock, and expired stock written off before", async () => {
    const bs = await db.select().from(s.invBatches).where(and(isNotNull(s.invBatches.expiryDate), sql`${s.invBatches.qtyOnHand} > 0`));
    const days = bs.map((b) => daysBetween(today, b.expiryDate!));
    expect(days.filter((d) => d >= 0 && d <= 30)).toHaveLength(2);
    expect(days.filter((d) => d < 0)).toHaveLength(1);
    const written = await db.execute(sql`select 1 from inv_movements m join inv_adjust_reasons r on r.id = m.reason_id where r.name = 'Expired' and m.qty_out > 0`);
    expect(written.rows.length).toBeGreaterThanOrEqual(2);
  });

  it("2 slow-moving items, and the imported SLA resin rate up about 18% since the first delivery", async () => {
    const used = await db.execute<{ id: string; last: string | null }>(sql`
      select i.id, (select max(d.doc_date)::text from inv_movements m join inv_documents d on d.id = m.document_id where m.item_id = i.id and d.type = 'OUT' and m.qty_out > 0) as last
      from inv_items i`);
    const all = await items();
    const slow = all.filter((i) => isSlowMoving({ qty: i.qtyOnHand, lastUsed: used.rows.find((u) => u.id === i.id)!.last }, today, 90));
    expect(slow.map((i) => i.name).sort()).toEqual(["Delrin rod (POM), 50 mm", "Origin 1 resin"]);

    const sla = all.find((i) => i.name === "SLA resin, imported (grey)")!;
    const rs = await db.execute<{ date: string; rate: string }>(sql`
      select d.doc_date::text as date, m.unit_cost as rate from inv_movements m join inv_documents d on d.id = m.document_id
      where m.item_id = ${sla.id} and d.type = 'IN' order by d.doc_date`);
    const rise = priceRise(rs.rows, addDays(today, -200), today, 10)!;
    expect(rise.risePct).toBeGreaterThan(17.5);
    expect(rise.risePct).toBeLessThan(18.5);
  });

  it("one completed stock count with small differences, adjusted in one record", async () => {
    const [c] = await db.select().from(s.invCounts);
    expect(c.status).toBe("COMPLETED");
    const mv = await db.select().from(s.invMovements).where(eq(s.invMovements.documentId, c.adjustmentDocId!));
    expect(mv).toHaveLength(3);
    expect(mv.every((m) => Number(m.qtyIn) + Number(m.qtyOut) <= 6)).toBe(true);
  });
});
