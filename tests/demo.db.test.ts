import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as s from "@/db/schema";
import { invoiceBalance } from "@/db/payment-writer";
import { toPaise } from "@/lib/pricing";
import { daysBetween, todayInIndia } from "@/lib/tickets";
import { loadDemoData, wipe } from "@/scripts/demo-data";
import { testDb } from "./helpers";

const skip = !!process.env.SKIP_DB_TESTS;
const { db, pool } = testDb();

describe.skipIf(skip)("demo data (database)", () => {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  beforeAll(async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN; // never upload from tests
    await db.transaction(async (tx) => {
      await wipe(tx);
      await loadDemoData(tx, { quiet: true, orders: { blobFolder: "local" } });
    });
  });
  afterAll(async () => {
    if (token) process.env.BLOB_READ_WRITE_TOKEN = token;
    await pool.end();
  });

  it("shows every situation on the board", async () => {
    const ts = await db.select().from(s.tickets);
    const count = (st: string) => ts.filter((t) => t.stage === st).length;
    expect({ w: count("WAITING_PO"), b: count("BILLING"), p: count("PAYMENT"), paid: count("PAID"), c: count("CANCELLED") }).toEqual({ w: 2, b: 2, p: 3, paid: 1, c: 1 });
    // the 2 Billing tickets share one PO
    expect(new Set(ts.filter((t) => t.stage === "BILLING").map((t) => t.poId)).size).toBe(1);
    // the MSME member SLA quotation is left as Sent, for the "mark it Accepted" demo step
    const [sla] = await db.select().from(s.quotations).where(eq(s.quotations.quoteNo, "ACDRI/QT/2026-27/0001"));
    expect(sla.status).toBe("SENT");
    expect(toPaise(sla.grandTotal)).toBe(8_496_00);
  });

  it("due dates: in 5 days, today, overdue by 12 days (with a note and a part payment incl. TDS)", async () => {
    const today = todayInIndia();
    const open = await db.select({ t: s.tickets, i: s.invoices }).from(s.tickets).innerJoin(s.invoices, eq(s.invoices.id, s.tickets.invoiceId)).where(eq(s.tickets.stage, "PAYMENT"));
    expect(open.map((r) => daysBetween(today, r.i.dueDate)).sort((a, b) => a - b)).toEqual([-12, 0, 5]);
    const overdue = open.find((r) => daysBetween(today, r.i.dueDate) === -12)!;
    const pays = await db.select().from(s.payments).where(eq(s.payments.invoiceId, overdue.i.id));
    expect(pays).toHaveLength(1);
    expect(toPaise(pays[0].tdsAmount)).toBeGreaterThan(0);
    expect(await db.select().from(s.followUps).where(eq(s.followUps.invoiceId, overdue.i.id))).toHaveLength(1);
    const left = (await invoiceBalance(db, overdue.i.id))!;
    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThan(toPaise(overdue.i.amount));
  });

  it("every invoice equals its tickets' totals, and every file is a sample PDF row", async () => {
    const invs = await db.select().from(s.invoices);
    for (const inv of invs) {
      const ts = await db.select().from(s.tickets).where(eq(s.tickets.invoiceId, inv.id));
      expect(ts.reduce((a, t) => a + toPaise(t.totalAmount), 0)).toBe(toPaise(inv.amount));
    }
    const files = await db.select().from(s.files);
    expect(files.filter((f) => f.kind === "PO")).toHaveLength(5);
    expect(files.filter((f) => f.kind === "INVOICE")).toHaveLength(4);
    expect(files.every((f) => f.blobPath.startsWith("local/") && f.mime === "application/pdf")).toBe(true);
  });
});
