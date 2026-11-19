import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { addInvoice, dueDateFor } from "@/db/invoice-writer";
import { addFollowUp, invoiceBalance, logReminder, recordPayment } from "@/db/payment-writer";
import { addPurchaseOrder, registerFile } from "@/db/po-writer";
import * as s from "@/db/schema";
import { changeQuotationStatus, moveTicketBack } from "@/db/ticket-writer";
import { freshDemoData, makeQuote, testDb, ticketsOf } from "./helpers";

const skip = !!process.env.SKIP_DB_TESTS;
const { db, pool } = testDb();
const TODAY = "2026-11-19";

/** Two services on one invoice of ₹10,000. */
async function invoiced() {
  const q = await makeQuote(db, "Western Drive", [
    { name: "Thermal shock chamber", q: { hours: 48 } },
    { name: "UTM", q: { samples: 5 } },
  ]);
  await changeQuotationStatus(db, q.id, "ACCEPTED", TODAY);
  const ts = await ticketsOf(db, q.id);
  const ids = ts.map((t) => t.id);
  await addPurchaseOrder(db, { ticketIds: ids, poNumber: "PO-1", poDate: TODAY, poAmountPaise: 100 }, TODAY);
  const fileId = await registerFile(db, { kind: "INVOICE", blobPath: "local/invoice/x.pdf", fileName: "x.pdf", size: 1, mime: "application/pdf" });
  const inv = await addInvoice(db, { ticketIds: ids, invoiceNumber: "INV-1", invoiceDate: "2026-11-01", amountPaise: 10_000_00, creditDays: 30, dueDate: dueDateFor("2026-11-01", 30), fileId }, TODAY);
  return { ids, invoiceId: inv.invoiceId, quotationId: q.id };
}
const pay = (invoiceId: string, amountPaise: number, tdsPaise = 0) => recordPayment(db, { invoiceId, amountPaise, tdsPaise, paidOn: TODAY, mode: "BANK" }, TODAY);

describe.skipIf(skip)("payments and follow-up (database)", () => {
  beforeEach(async () => {
    await freshDemoData(db);
  });
  afterAll(async () => {
    await pool.end();
  });

  it("amount left = invoice - payments - TDS; reaching ₹0 moves every ticket on the invoice to Paid", async () => {
    const { invoiceId, quotationId } = await invoiced();
    const r1 = await pay(invoiceId, 4_000_00, 200_00);
    expect(r1).toMatchObject({ leftPaise: 5_800_00, paid: false });
    expect(await invoiceBalance(db, invoiceId)).toBe(5_800_00);
    expect((await ticketsOf(db, quotationId)).every((t) => t.stage === "PAYMENT")).toBe(true);
    const r2 = await pay(invoiceId, 5_800_00);
    expect(r2).toMatchObject({ leftPaise: 0, paid: true, ticketCount: 2 });
    expect((await ticketsOf(db, quotationId)).every((t) => t.stage === "PAID")).toBe(true);
    const ev = await db.select().from(s.ticketEvents).where(eq(s.ticketEvents.type, "PAID"));
    expect(ev).toHaveLength(2);
  });

  it("overpaying is blocked (amount + TDS can't exceed the amount left)", async () => {
    const { invoiceId } = await invoiced();
    await expect(pay(invoiceId, 10_000_01)).rejects.toThrow(/more than the amount left/);
    await expect(pay(invoiceId, 9_900_00, 100_01)).rejects.toThrow(/more than the amount left/);
    await expect(pay(invoiceId, 0, 0)).rejects.toThrow(/amount received/);
    await expect(recordPayment(db, { invoiceId, amountPaise: 100, tdsPaise: 0, paidOn: "2026-11-20", mode: "UPI" }, TODAY)).rejects.toThrow(/future/);
    expect(await db.select().from(s.payments)).toHaveLength(0);
  });

  it("no more payments once paid; two payments at once can't overpay together", async () => {
    const { invoiceId } = await invoiced();
    const both = await Promise.allSettled([pay(invoiceId, 6_000_00), pay(invoiceId, 6_000_00)]);
    expect(both.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    await pay(invoiceId, 4_000_00);
    await expect(pay(invoiceId, 1)).rejects.toThrow(/fully paid/);
  });

  it("notes and reminders go on every ticket of the invoice and count as contact", async () => {
    const { invoiceId, ids } = await invoiced();
    await addFollowUp(db, { invoiceId, method: "CALL", note: "Spoke to accounts, payment next week", nextFollowUpDate: "2026-11-25" });
    await logReminder(db, invoiceId, "WHATSAPP");
    for (const id of ids) {
      const types = (await db.select().from(s.ticketEvents).where(eq(s.ticketEvents.ticketId, id))).map((e) => e.type);
      expect(types).toEqual(expect.arrayContaining(["NOTE", "REMINDER_WHATSAPP"]));
    }
    const [wa] = await db.select().from(s.ticketEvents).where(eq(s.ticketEvents.type, "REMINDER_WHATSAPP"));
    expect(wa.message).toMatch(/^WhatsApp reminder opened by Demo User/);
    await expect(addFollowUp(db, { invoiceId, method: "CALL", note: "x" })).rejects.toThrow(/short note/);
  });

  it("an invoice with a payment can't be moved back to Billing", async () => {
    const { invoiceId, ids } = await invoiced();
    await pay(invoiceId, 100_00);
    await expect(moveTicketBack(db, ids[0], "Wrong invoice")).rejects.toThrow(/Payments are already recorded/);
  });
});
