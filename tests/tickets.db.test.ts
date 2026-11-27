import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { updateQuotation, UserFacingError } from "@/db/quote-writer";
import * as s from "@/db/schema";
import { backfillTickets, cancelTicket, changeQuotationStatus, planStatusChange } from "@/db/ticket-writer";
import { toPaise } from "@/lib/pricing";
import { freshDemoData, makeQuote, testDb, ticketsOf } from "./helpers";

const skip = !!process.env.SKIP_DB_TESTS;
const { db, pool } = testDb();
const TODAY = "2026-11-19";
const THREE = [
  { name: "Thermal shock chamber", q: { hours: 48 } },
  { name: "UTM", q: { samples: 5 } },
  { name: "Xenon test chamber", q: { hours: 8, samples: 5 } },
];

describe.skipIf(skip)("tickets (database)", () => {
  beforeEach(async () => {
    await freshDemoData(db);
  });
  afterAll(async () => {
    await pool.end();
  });

  it("accepting a quotation with 3 services opens exactly 3 tickets; accepting again opens none", async () => {
    const q = await makeQuote(db, "Western Drive", THREE);
    expect(await planStatusChange(db, q.id, "ACCEPTED")).toEqual({ kind: "open", open: 3, reopen: 0 });
    const r1 = await changeQuotationStatus(db, q.id, "ACCEPTED", TODAY);
    expect(r1.opened).toBe(3);
    const r2 = await changeQuotationStatus(db, q.id, "ACCEPTED", TODAY);
    expect(r2.opened).toBe(0);
    const ts = await ticketsOf(db, q.id);
    expect(ts).toHaveLength(3);
    expect(ts.every((t) => t.stage === "WAITING_PO")).toBe(true);
    expect(new Set(ts.map((t) => t.quotationItemId)).size).toBe(3);
  });

  it("ticket totals add up exactly to the quotation grand total (discount and round off included)", async () => {
    const q = await makeQuote(db, "Western Drive", THREE);
    await changeQuotationStatus(db, q.id, "ACCEPTED", TODAY);
    const [quote] = await db.select().from(s.quotations).where(eq(s.quotations.id, q.id));
    const ts = await ticketsOf(db, q.id);
    const sum = (k: "totalAmount" | "taxableValue" | "discountAmount" | "listAmount" | "cgst" | "sgst") =>
      ts.reduce((a, t) => a + toPaise(t[k]), 0);
    expect(sum("totalAmount")).toBe(toPaise(quote.grandTotal));
    expect(sum("taxableValue")).toBe(toPaise(quote.taxableValue));
    expect(sum("discountAmount")).toBe(toPaise(quote.discountTotal));
    expect(sum("listAmount")).toBe(toPaise(quote.subtotal));
    expect(sum("cgst")).toBe(toPaise(quote.cgst));
    expect(sum("sgst")).toBe(toPaise(quote.sgst));
    expect(toPaise(quote.roundOff)).not.toBe(0); // this case really has a round off
  });

  it("10 quotations accepted at the same moment get unique ticket numbers", async () => {
    const qs = [];
    for (let i = 0; i < 10; i++) qs.push(await makeQuote(db, "Sahyadri", [{ name: "SLA - imported resin", q: { ccPerPart: 10 + i, parts: 2 } }, { name: "SLS", q: { ccPerPart: 5, parts: 1 } }]));
    await Promise.all(qs.map((q) => changeQuotationStatus(db, q.id, "ACCEPTED", TODAY)));
    const all = await db.select({ no: s.tickets.ticketNo }).from(s.tickets);
    // 10 x 2 new + 1 from the demo quotation's backfill-free seed (none yet)
    const nos = all.map((t) => t.no);
    expect(new Set(nos).size).toBe(nos.length);
    expect(nos.filter((n) => n.startsWith("DMC/TK/2026-27/")).length).toBe(20);
  });

  it("un-accepting cancels tickets still waiting for a PO, and re-accepting reopens the same tickets", async () => {
    const q = await makeQuote(db, "Western Drive", THREE);
    await changeQuotationStatus(db, q.id, "ACCEPTED", TODAY);
    const before = (await ticketsOf(db, q.id)).map((t) => t.ticketNo);
    expect(await planStatusChange(db, q.id, "SENT")).toEqual({ kind: "cancel", cancel: 3 });
    const r = await changeQuotationStatus(db, q.id, "SENT", TODAY);
    expect(r.cancelled).toBe(3);
    expect((await ticketsOf(db, q.id)).every((t) => t.stage === "CANCELLED" && t.autoCancelled)).toBe(true);
    const again = await changeQuotationStatus(db, q.id, "ACCEPTED", TODAY);
    expect(again).toMatchObject({ opened: 0, reopened: 3 });
    const after = await ticketsOf(db, q.id);
    expect(after.map((t) => t.ticketNo)).toEqual(before);
    expect(after.every((t) => t.stage === "WAITING_PO")).toBe(true);
  });

  it("blocks un-accepting once a ticket has moved on", async () => {
    const q = await makeQuote(db, "Western Drive", THREE);
    await changeQuotationStatus(db, q.id, "ACCEPTED", TODAY);
    const [t] = await ticketsOf(db, q.id);
    await db.update(s.tickets).set({ stage: "BILLING" }).where(eq(s.tickets.id, t.id));
    const plan = await planStatusChange(db, q.id, "REJECTED");
    expect(plan.kind).toBe("blocked");
    await expect(changeQuotationStatus(db, q.id, "REJECTED", TODAY)).rejects.toBeInstanceOf(UserFacingError);
    const [quote] = await db.select().from(s.quotations).where(eq(s.quotations.id, q.id));
    expect(quote.status).toBe("ACCEPTED");
  });

  it("locks a quotation once it has tickets", async () => {
    const q = await makeQuote(db, "Western Drive", THREE);
    await changeQuotationStatus(db, q.id, "ACCEPTED", TODAY);
    await expect(
      updateQuotation(db, q.id, { customerId: (await ticketsOf(db, q.id))[0].customerId, quoteDate: TODAY, validUntil: TODAY, subject: "x", notes: null, terms: "-", status: "ACCEPTED", lines: [] }),
    ).rejects.toThrow(/locked/);
  });

  it("cancelling a ticket keeps it, with the reason, and a manual cancel is not undone by re-accepting", async () => {
    const q = await makeQuote(db, "Western Drive", THREE);
    await changeQuotationStatus(db, q.id, "ACCEPTED", TODAY);
    const [t] = await ticketsOf(db, q.id);
    await cancelTicket(db, t.id, "Customer dropped this service");
    await changeQuotationStatus(db, q.id, "ACCEPTED", TODAY);
    const [t2] = await ticketsOf(db, q.id);
    expect(t2).toMatchObject({ stage: "CANCELLED", cancelReason: "Customer dropped this service", autoCancelled: false });
    const ev = await db.select().from(s.ticketEvents).where(eq(s.ticketEvents.ticketId, t.id));
    expect(ev.map((e) => e.type)).toEqual(["OPENED", "CANCELLED"]);
  });

  it("backfill opens tickets for already-accepted quotations, once", async () => {
    // A quotation accepted before tickets existed.
    await db.update(s.quotations).set({ status: "ACCEPTED" });
    const first = await backfillTickets(db, TODAY);
    const second = await backfillTickets(db, TODAY);
    expect(first.flatMap((r) => r.opened).length).toBeGreaterThan(0);
    expect(second.flatMap((r) => r.opened)).toEqual([]);
  });
});
