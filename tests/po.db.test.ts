import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { addPurchaseOrder, DuplicatePoError, findPo, registerFile } from "@/db/po-writer";
import { UserFacingError } from "@/db/quote-writer";
import * as s from "@/db/schema";
import { changeQuotationStatus, moveTicketBack } from "@/db/ticket-writer";
import { freshDemoData, makeQuote, testDb, ticketsOf } from "./helpers";

const skip = !!process.env.SKIP_DB_TESTS;
const { db, pool } = testDb();
const TODAY = "2026-11-19";
const THREE = [
  { name: "Thermal shock chamber", q: { hours: 48 } },
  { name: "UTM", q: { samples: 5 } },
  { name: "Xenon test chamber", q: { hours: 8, samples: 5 } },
];

async function acceptedThree() {
  const q = await makeQuote(db, "Western Drive", THREE);
  await changeQuotationStatus(db, q.id, "ACCEPTED", TODAY);
  return ticketsOf(db, q.id);
}

describe.skipIf(skip)("purchase orders (database)", () => {
  beforeEach(async () => {
    await freshDemoData(db);
  });
  afterAll(async () => {
    await pool.end();
  });

  it("one PO saved on 3 tickets moves all 3 to Billing, with a PO_ADDED event each", async () => {
    const ts = await acceptedThree();
    const fileId = await registerFile(db, { kind: "PO", blobPath: "local/po/x.pdf", fileName: "x.pdf", size: 10, mime: "application/pdf" });
    const r = await addPurchaseOrder(db, { ticketIds: ts.map((t) => t.id), poNumber: "PO-77", poDate: TODAY, poAmountPaise: 100_00, fileId, notes: null }, TODAY);
    expect(r.moved).toHaveLength(3);
    const after = await db.select().from(s.tickets).where(eq(s.tickets.poId, r.poId));
    expect(after).toHaveLength(3);
    expect(after.every((t) => t.stage === "BILLING")).toBe(true);
    const ev = await db.select().from(s.ticketEvents).where(eq(s.ticketEvents.type, "PO_ADDED"));
    expect(ev).toHaveLength(3);
    const [po] = await db.select().from(s.purchaseOrders).where(eq(s.purchaseOrders.id, r.poId));
    expect(po).toMatchObject({ poNumber: "PO-77", poAmount: "100.00", fileId });
  });

  it("refuses a duplicate PO number for the same customer, and offers the existing PO", async () => {
    const ts = await acceptedThree();
    await addPurchaseOrder(db, { ticketIds: [ts[0].id], poNumber: "PO-1", poDate: TODAY, poAmountPaise: 500 }, TODAY);
    const err = await addPurchaseOrder(db, { ticketIds: [ts[1].id], poNumber: " po-1 ", poDate: TODAY, poAmountPaise: 500 }, TODAY).catch((e) => e);
    expect(err).toBeInstanceOf(DuplicatePoError);
    expect((err as DuplicatePoError).existing.ticketNos).toEqual([ts[0].ticketNo]);
    // linking to the existing PO works
    const linked = await addPurchaseOrder(db, { ticketIds: [ts[1].id], existingPoId: (err as DuplicatePoError).existing.id }, TODAY);
    expect(linked.poNumber).toBe("PO-1");
    expect((await findPo(db, ts[0].customerId, "PO-1"))?.ticketNos).toHaveLength(2);
    expect(await db.select().from(s.purchaseOrders)).toHaveLength(1);
  });

  it("the same PO number is fine for a different customer", async () => {
    const ts = await acceptedThree();
    const q2 = await makeQuote(db, "Sahyadri", [{ name: "SLS", q: { ccPerPart: 5, parts: 1 } }]);
    await changeQuotationStatus(db, q2.id, "ACCEPTED", TODAY);
    const [t2] = await ticketsOf(db, q2.id);
    await addPurchaseOrder(db, { ticketIds: [ts[0].id], poNumber: "PO-1", poDate: TODAY, poAmountPaise: 500 }, TODAY);
    await expect(addPurchaseOrder(db, { ticketIds: [t2.id], poNumber: "PO-1", poDate: TODAY, poAmountPaise: 500 }, TODAY)).resolves.toBeTruthy();
  });

  it("blocks future dates, mixed customers, and tickets that already moved on", async () => {
    const ts = await acceptedThree();
    await expect(addPurchaseOrder(db, { ticketIds: [ts[0].id], poNumber: "A", poDate: "2026-11-20", poAmountPaise: 500 }, TODAY)).rejects.toThrow(/future/);
    const q2 = await makeQuote(db, "Sahyadri", [{ name: "SLS", q: { ccPerPart: 5, parts: 1 } }]);
    await changeQuotationStatus(db, q2.id, "ACCEPTED", TODAY);
    const [t2] = await ticketsOf(db, q2.id);
    await expect(addPurchaseOrder(db, { ticketIds: [ts[0].id, t2.id], poNumber: "A", poDate: TODAY, poAmountPaise: 500 }, TODAY)).rejects.toThrow(/same customer/);
    await addPurchaseOrder(db, { ticketIds: [ts[0].id], poNumber: "A", poDate: TODAY, poAmountPaise: 500 }, TODAY);
    await expect(addPurchaseOrder(db, { ticketIds: [ts[0].id], poNumber: "B", poDate: TODAY, poAmountPaise: 500 }, TODAY)).rejects.toBeInstanceOf(UserFacingError);
  });

  it("moving back clears the PO link but keeps the PO record", async () => {
    const ts = await acceptedThree();
    const r = await addPurchaseOrder(db, { ticketIds: [ts[0].id], poNumber: "PO-9", poDate: TODAY, poAmountPaise: 500 }, TODAY);
    await moveTicketBack(db, ts[0].id, "Wrong PO attached");
    const [t] = await db.select().from(s.tickets).where(eq(s.tickets.id, ts[0].id));
    expect(t).toMatchObject({ stage: "WAITING_PO", poId: null });
    expect(await db.select().from(s.purchaseOrders).where(eq(s.purchaseOrders.id, r.poId))).toHaveLength(1);
  });

  it("two people saving the same PO number at once: one wins, the other is offered the link", async () => {
    const ts = await acceptedThree();
    const results = await Promise.allSettled([
      addPurchaseOrder(db, { ticketIds: [ts[0].id], poNumber: "RACE", poDate: TODAY, poAmountPaise: 500 }, TODAY),
      addPurchaseOrder(db, { ticketIds: [ts[1].id], poNumber: "RACE", poDate: TODAY, poAmountPaise: 500 }, TODAY),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(failed.reason).toBeInstanceOf(DuplicatePoError);
  });
});
