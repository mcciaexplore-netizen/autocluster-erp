/**
 * Payment follow-up: payments, follow-up notes and reminders.
 * They all belong to the INVOICE; every ticket on the invoice gets the timeline entry
 * and the tickets move together.
 * Free of Next.js imports so scripts and tests can use it.
 *
 * Rules:
 * - Amount left = invoice amount - payments - TDS.
 * - A payment (amount + TDS) can't be more than the amount left.
 * - When the amount left reaches ₹0, every ticket on the invoice moves to Paid.
 */
import { actorName } from "../lib/auth/actor";
import { and, eq } from "drizzle-orm";
import { formatDate } from "../lib/format";
import { formatINR, paiseToRupeeString, toPaise } from "../lib/pricing";
import { amountLeft, paymentProblem } from "../lib/tickets";
import type { DB, Tx } from "./client";
import { UserFacingError } from "./quote-writer";
import { followUps, invoices, payments, tickets } from "./schema";
import { addEvents } from "./ticket-writer";

type Conn = DB | Tx;

export const PAYMENT_MODES = { BANK: "Bank transfer (NEFT / RTGS / IMPS)", UPI: "UPI", CHEQUE: "Cheque", CASH: "Cash" } as const;
export const FOLLOW_UP_METHODS = { CALL: "Call", WHATSAPP: "WhatsApp", EMAIL: "Email", VISIT: "Visit", OTHER: "Other" } as const;
export type PaymentMode = keyof typeof PAYMENT_MODES;
export type FollowUpMethod = keyof typeof FOLLOW_UP_METHODS;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Locks the invoice and returns it with its open tickets (still in Payment follow-up). */
async function lockInvoice(tx: Tx, invoiceId: string) {
  const [inv] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).for("update");
  if (!inv) throw new UserFacingError("This invoice could not be found.");
  const ts = await tx.select({ id: tickets.id, stage: tickets.stage }).from(tickets).where(eq(tickets.invoiceId, invoiceId));
  return { inv, ticketIds: ts.map((t) => t.id), openIds: ts.filter((t) => t.stage === "PAYMENT").map((t) => t.id) };
}

export async function invoiceBalance(conn: Conn, invoiceId: string) {
  const [inv] = await conn.select({ amount: invoices.amount }).from(invoices).where(eq(invoices.id, invoiceId));
  if (!inv) return null;
  const ps = await conn.select({ a: payments.amount, t: payments.tdsAmount }).from(payments).where(eq(payments.invoiceId, invoiceId));
  return amountLeft({ amountPaise: toPaise(inv.amount), payments: ps.map((p) => ({ amountPaise: toPaise(p.a), tdsPaise: toPaise(p.t) })) });
}

export interface PaymentInput {
  invoiceId: string;
  amountPaise: number;
  tdsPaise: number;
  paidOn: string;
  mode: PaymentMode;
  reference?: string | null;
  notes?: string | null;
}

export async function recordPayment(db: DB, input: PaymentInput, today: string) {
  if (!ISO.test(input.paidOn)) throw new UserFacingError("Please enter the payment date.");
  if (input.paidOn > today) throw new UserFacingError("The payment date can't be in the future.");
  if (!(input.mode in PAYMENT_MODES)) throw new UserFacingError("Please choose how the payment was made.");
  if (!Number.isInteger(input.amountPaise) || !Number.isInteger(input.tdsPaise)) throw new UserFacingError("Please enter the amounts in rupees.");

  return db.transaction(async (tx) => {
    const { inv, ticketIds, openIds } = await lockInvoice(tx, input.invoiceId);
    if (!openIds.length) throw new UserFacingError("This invoice is already fully paid or no longer in Payment follow-up.");
    const left = (await invoiceBalance(tx, inv.id))!;
    const problem = paymentProblem(left, input.amountPaise, input.tdsPaise);
    if (problem) throw new UserFacingError(problem);

    await tx.insert(payments).values({
      invoiceId: inv.id,
      amount: paiseToRupeeString(input.amountPaise),
      tdsAmount: paiseToRupeeString(input.tdsPaise),
      paidOn: input.paidOn,
      mode: input.mode,
      reference: input.reference?.trim() || null,
      notes: input.notes?.trim() || null,
    });
    const leftAfter = left - input.amountPaise - input.tdsPaise;
    const tds = input.tdsPaise ? ` + TDS ${formatINR(input.tdsPaise)}` : "";
    const ref = input.reference?.trim() ? `, ref. ${input.reference.trim()}` : "";
    await addEvents(
      tx,
      ticketIds,
      "PAYMENT",
      `Payment received for invoice ${inv.invoiceNumber}: ${formatINR(input.amountPaise)}${tds} on ${formatDate(input.paidOn)} by ${PAYMENT_MODES[input.mode]}${ref}. ${leftAfter > 0 ? `${formatINR(leftAfter)} left.` : "Nothing left to pay."}`,
      { invoiceId: inv.id, leftPaise: leftAfter },
    );

    if (leftAfter === 0) {
      await tx.update(tickets).set({ stage: "PAID", stageChangedAt: new Date(), updatedAt: new Date() }).where(and(eq(tickets.invoiceId, inv.id), eq(tickets.stage, "PAYMENT")));
      await addEvents(tx, openIds, "PAID", `Invoice ${inv.invoiceNumber} paid in full. Moved to Paid.`, { invoiceId: inv.id });
    }
    return { invoiceNumber: inv.invoiceNumber, leftPaise: leftAfter, paid: leftAfter === 0, ticketCount: openIds.length };
  });
}

export interface FollowUpInput {
  invoiceId: string;
  method: FollowUpMethod;
  note: string;
  promisedDate?: string | null;
  nextFollowUpDate?: string | null;
}

export async function addFollowUp(db: DB, input: FollowUpInput) {
  const note = input.note.trim();
  if (note.length < 3) throw new UserFacingError("Please write a short note, e.g. “Spoke to accounts, payment next week”.");
  if (!(input.method in FOLLOW_UP_METHODS)) throw new UserFacingError("Please choose how you followed up.");
  for (const d of [input.promisedDate, input.nextFollowUpDate]) if (d && !ISO.test(d)) throw new UserFacingError("Please check the dates.");

  return db.transaction(async (tx) => {
    const { inv, ticketIds, openIds } = await lockInvoice(tx, input.invoiceId);
    if (!openIds.length) throw new UserFacingError("This invoice is no longer in Payment follow-up.");
    await tx.insert(followUps).values({
      invoiceId: inv.id,
      method: input.method,
      note,
      promisedDate: input.promisedDate || null,
      nextFollowUpDate: input.nextFollowUpDate || null,
    });
    const extra = [
      input.promisedDate ? `Promised payment by ${formatDate(input.promisedDate)}.` : "",
      input.nextFollowUpDate ? `Next follow-up ${formatDate(input.nextFollowUpDate)}.` : "",
    ]
      .filter(Boolean)
      .join(" ");
    await addEvents(tx, ticketIds, "NOTE", `${FOLLOW_UP_METHODS[input.method]} note: ${note}${extra ? ` ${extra}` : ""}`, { invoiceId: inv.id });
    return { invoiceNumber: inv.invoiceNumber };
  });
}

/** "WhatsApp reminder opened by Meera Iyer" on every ticket of the invoice. */
export async function logReminder(db: DB, invoiceId: string, channel: "WHATSAPP" | "EMAIL") {
  return db.transaction(async (tx) => {
    const { inv, ticketIds } = await lockInvoice(tx, invoiceId);
    await addEvents(
      tx,
      ticketIds,
      channel === "WHATSAPP" ? "REMINDER_WHATSAPP" : "REMINDER_EMAIL",
      `${channel === "WHATSAPP" ? "WhatsApp" : "Email"} reminder opened by ${await actorName()} (invoice ${inv.invoiceNumber})`,
      { invoiceId: inv.id },
    );
    return { ok: true };
  });
}
