/**
 * Tickets: opening, numbering, quotation status rules and cancelling.
 * Free of Next.js imports so scripts (seed, backfill) and tests can use it.
 *
 * Rules:
 * - Accepting a quotation opens ONE ticket per quotation line, in one transaction.
 * - Never twice: tickets are unique per quotation line. If a quotation goes
 *   Accepted -> Sent -> Accepted, the same tickets are reopened, not duplicated.
 * - Ticket numbers come from a per-financial-year counter locked in the transaction.
 * - The quotation row is locked (FOR UPDATE) while its tickets change, so two
 *   people clicking at once can't both open tickets.
 */
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { financialYear, formatQuoteNo, paiseToRupeeString, quantityInWords, toPaise } from "../lib/pricing";
import { splitQuotation } from "../lib/tickets";
import type { DB, Tx } from "./client";
import { UserFacingError } from "./quote-writer";
import { markLeadWonForQuotation, noteQuotationRejected } from "./lead-links";
import { quotationItems, quotations, settings, ticketCounters, ticketEvents, tickets, type TicketSnapshot } from "./schema";

type Conn = DB | Tx;
export const STAFF_NAME = "Demo User";
export const AUTO_CANCEL_REASON = "Quotation is no longer marked Accepted";

export async function nextTicketSeq(tx: Conn, fy: string): Promise<number> {
  const [row] = await tx
    .insert(ticketCounters)
    .values({ fy, lastSeq: 1 })
    .onConflictDoUpdate({ target: ticketCounters.fy, set: { lastSeq: sql`${ticketCounters.lastSeq} + 1` } })
    .returning({ seq: ticketCounters.lastSeq });
  return row.seq;
}

export async function addEvents(
  tx: Conn,
  ticketIds: string[],
  type: string,
  message: string,
  data?: Record<string, unknown>,
) {
  if (!ticketIds.length) return;
  await tx.insert(ticketEvents).values(ticketIds.map((ticketId) => ({ ticketId, type, message, data: data ?? null, createdBy: STAFF_NAME })));
}

async function lockQuotation(tx: Conn, id: string) {
  const rows = await tx.execute<{ id: string; status: string }>(sql`select id, status from quotations where id = ${id} and deleted_at is null for update`);
  if (!rows.rows.length) throw new UserFacingError("This quotation could not be found.");
  return rows.rows[0];
}

/** Opens tickets for every line that doesn't have one yet, and reopens auto-cancelled ones. */
export async function openTicketsForQuotation(tx: Conn, quotationId: string, today: string) {
  const [q] = await tx.select().from(quotations).where(eq(quotations.id, quotationId));
  const items = await tx.select().from(quotationItems).where(eq(quotationItems.quotationId, quotationId)).orderBy(quotationItems.sortOrder);
  const existing = await tx.select().from(tickets).where(eq(tickets.quotationId, quotationId));
  const byItem = new Map(existing.map((t) => [t.quotationItemId, t]));

  // Reopen tickets that were cancelled only because the quotation stopped being Accepted.
  const toReopen = existing.filter((t) => t.stage === "CANCELLED" && t.autoCancelled);
  if (toReopen.length) {
    const ids = toReopen.map((t) => t.id);
    await tx
      .update(tickets)
      .set({ stage: "WAITING_PO", autoCancelled: false, cancelReason: null, stageChangedAt: new Date() })
      .where(inArray(tickets.id, ids));
    await addEvents(tx, ids, "REOPENED", `Reopened: quotation ${q.quoteNo} marked Accepted again`);
  }

  const missing = items.filter((it) => !byItem.has(it.id));
  if (!missing.length) return { opened: [] as { id: string; ticketNo: string }[], reopened: toReopen.length };

  const n = (v: string | null) => (v == null ? null : Number(v));
  const values = splitQuotation(
    {
      intraState: toPaise(q.igst) === 0,
      gstPct: Number(q.gstPct),
      cgstPaise: toPaise(q.cgst),
      sgstPaise: toPaise(q.sgst),
      igstPaise: toPaise(q.igst),
      grandTotalPaise: toPaise(q.grandTotal),
    },
    items.map((it) => ({ billableQty: Number(it.billableQty), listRatePaise: toPaise(it.listRate), amountPaise: toPaise(it.amount) })),
  );
  const [s] = await tx.select({ prefix: settings.ticketPrefix }).from(settings).where(eq(settings.id, 1));
  const fy = financialYear(new Date(`${today}T00:00:00`));

  const opened: { id: string; ticketNo: string }[] = [];
  for (const it of missing) {
    const v = values[items.indexOf(it)];
    const seq = await nextTicketSeq(tx, fy);
    const ticketNo = formatQuoteNo(s?.prefix ?? "ACDRI/TK", fy, seq);
    const snapshot: TicketSnapshot = {
      quoteNo: q.quoteNo,
      companyName: q.customerSnapshot.companyName,
      deptCode: it.deptCode,
      description: it.description,
      notes: it.notes,
      quantityText: quantityInWords(
        it.isCustomItem ? null : it.unitType,
        { ccPerPart: n(it.ccPerPart), parts: it.parts, hours: n(it.hours), samples: it.samples, quantity: Number(it.billableQty) },
        it.unitLabel.replace(/^per\s+/i, ""),
      ),
      billableQty: it.billableQty,
      unitLabel: it.unitLabel,
      listRate: it.listRate,
      finalRate: it.finalRate,
      discountPct: it.discountPct,
      isCustomRate: it.isCustomRate,
      isCustomItem: it.isCustomItem,
      intraState: toPaise(q.igst) === 0,
      gstPct: q.gstPct,
      roundOff: paiseToRupeeString(v.roundOffPaise),
    };
    const [row] = await tx
      .insert(tickets)
      .values({
        ticketNo,
        fy,
        seq,
        quotationId,
        quotationItemId: it.id,
        customerId: q.customerId,
        snapshot,
        listAmount: paiseToRupeeString(v.listPaise),
        discountAmount: paiseToRupeeString(v.discountPaise),
        taxableValue: paiseToRupeeString(v.taxablePaise),
        cgst: paiseToRupeeString(v.cgstPaise),
        sgst: paiseToRupeeString(v.sgstPaise),
        igst: paiseToRupeeString(v.igstPaise),
        totalAmount: paiseToRupeeString(v.totalPaise),
      })
      .onConflictDoNothing({ target: tickets.quotationItemId })
      .returning({ id: tickets.id, ticketNo: tickets.ticketNo });
    if (row) {
      opened.push(row);
      await addEvents(tx, [row.id], "OPENED", `Ticket opened: quotation ${q.quoteNo} accepted`, { quoteNo: q.quoteNo });
    }
  }
  return { opened, reopened: toReopen.length };
}

export type StatusChangePlan =
  | { kind: "none" }
  | { kind: "open"; open: number; reopen: number }
  | { kind: "cancel"; cancel: number }
  | { kind: "blocked"; message: string };

/** What changing a quotation's status would do to its tickets. Read-only. */
export async function planStatusChange(conn: Conn, quotationId: string, to: string): Promise<StatusChangePlan> {
  const [q] = await conn.select({ status: quotations.status }).from(quotations).where(eq(quotations.id, quotationId));
  if (!q) return { kind: "blocked", message: "This quotation could not be found." };
  const items = await conn.select({ id: quotationItems.id }).from(quotationItems).where(eq(quotationItems.quotationId, quotationId));
  const ts = await conn.select().from(tickets).where(eq(tickets.quotationId, quotationId));

  if (to === "ACCEPTED") {
    const withTicket = new Set(ts.map((t) => t.quotationItemId));
    const open = items.filter((i) => !withTicket.has(i.id)).length;
    const reopen = ts.filter((t) => t.stage === "CANCELLED" && t.autoCancelled).length;
    return open || reopen ? { kind: "open", open, reopen } : { kind: "none" };
  }
  if (q.status !== "ACCEPTED") return { kind: "none" };
  const live = ts.filter((t) => t.stage !== "CANCELLED");
  if (!live.length) return { kind: "none" };
  const moved = live.filter((t) => t.stage !== "WAITING_PO");
  if (moved.length) {
    return {
      kind: "blocked",
      message: `This quotation can't be changed from Accepted, because ${moved.length} of its ${live.length === 1 ? "service has" : "services have"} already moved past “Waiting for PO” (a PO or invoice has been added). If the customer changed their mind, cancel or move those tickets back on the Orders & Billing board first.`,
    };
  }
  return { kind: "cancel", cancel: live.length };
}

/** Changes a quotation's status and applies the ticket rules, all in one transaction. */
export async function changeQuotationStatus(db: DB, quotationId: string, to: "DRAFT" | "SENT" | "ACCEPTED" | "REJECTED", today: string) {
  return db.transaction(async (tx) => {
    await lockQuotation(tx, quotationId);
    const plan = await planStatusChange(tx, quotationId, to);
    if (plan.kind === "blocked") throw new UserFacingError(plan.message);
    await tx.update(quotations).set({ status: to }).where(eq(quotations.id, quotationId));
    if (to === "ACCEPTED") {
      const r = await openTicketsForQuotation(tx, quotationId, today);
      const won = await markLeadWonForQuotation(tx, quotationId);
      return { opened: r.opened.length, reopened: r.reopened, cancelled: 0, leadWon: won?.leadNo ?? null };
    }
    if (to === "REJECTED" && plan.kind !== "cancel") await noteQuotationRejected(tx, quotationId);
    if (plan.kind === "cancel") {
      const live = await tx
        .select({ id: tickets.id })
        .from(tickets)
        .where(and(eq(tickets.quotationId, quotationId), ne(tickets.stage, "CANCELLED")));
      const ids = live.map((t) => t.id);
      await tx
        .update(tickets)
        .set({ stage: "CANCELLED", autoCancelled: true, cancelReason: AUTO_CANCEL_REASON, stageChangedAt: new Date() })
        .where(inArray(tickets.id, ids));
      await addEvents(tx, ids, "CANCELLED", `Cancelled: ${AUTO_CANCEL_REASON.toLowerCase()}`);
      if (to === "REJECTED") await noteQuotationRejected(tx, quotationId);
      return { opened: 0, reopened: 0, cancelled: ids.length, leadWon: null };
    }
    return { opened: 0, reopened: 0, cancelled: 0, leadWon: null as string | null };
  });
}

export async function quotationHasTickets(conn: Conn, quotationId: string): Promise<boolean> {
  const r = await conn.select({ id: tickets.id }).from(tickets).where(eq(tickets.quotationId, quotationId)).limit(1);
  return r.length > 0;
}

/** Cancels one ticket with a reason. Only before it is invoiced. */
export async function cancelTicket(db: DB, ticketId: string, reason: string) {
  return db.transaction(async (tx) => {
    const r = await tx.execute<{ stage: string; ticket_no: string }>(sql`select stage, ticket_no from tickets where id = ${ticketId} for update`);
    const t = r.rows[0];
    if (!t) throw new UserFacingError("This ticket could not be found.");
    if (t.stage === "CANCELLED") throw new UserFacingError("This ticket is already cancelled.");
    if (t.stage === "PAYMENT" || t.stage === "PAID") {
      throw new UserFacingError("This service is already on a tax invoice, so it can't be cancelled. Move it back to Billing first if the invoice was wrong.");
    }
    await tx.update(tickets).set({ stage: "CANCELLED", cancelReason: reason, autoCancelled: false, stageChangedAt: new Date() }).where(eq(tickets.id, ticketId));
    await addEvents(tx, [ticketId], "CANCELLED", `Cancelled: ${reason}`, { from: t.stage });
  });
}

/** Opens tickets for quotations that are Accepted but have none. Safe to run many times. */
export async function backfillTickets(db: DB, today: string) {
  const accepted = await db.select({ id: quotations.id, quoteNo: quotations.quoteNo }).from(quotations).where(eq(quotations.status, "ACCEPTED"));
  const results: { quoteNo: string; opened: string[] }[] = [];
  for (const q of accepted) {
    const r = await db.transaction(async (tx) => {
      await lockQuotation(tx, q.id);
      return openTicketsForQuotation(tx, q.id, today);
    });
    results.push({ quoteNo: q.quoteNo, opened: r.opened.map((o) => o.ticketNo) });
  }
  return results;
}

/**
 * Moves a ticket one step back, with a reason. The history is kept: the PO or
 * invoice record stays, only this ticket's link to it is cleared.
 */
export async function moveTicketBack(db: DB, ticketId: string, reason: string) {
  return db.transaction(async (tx) => {
    const r = await tx.execute<{ stage: string; po_id: string | null; invoice_id: string | null }>(
      sql`select stage, po_id, invoice_id from tickets where id = ${ticketId} for update`,
    );
    const t = r.rows[0];
    if (!t) throw new UserFacingError("This ticket could not be found.");
    if (t.stage === "BILLING") {
      await tx.update(tickets).set({ stage: "WAITING_PO", poId: null, stageChangedAt: new Date() }).where(eq(tickets.id, ticketId));
      await addEvents(tx, [ticketId], "MOVED_BACK", `Moved back to Waiting for PO: ${reason}`, { from: "BILLING", to: "WAITING_PO", poId: t.po_id, reason });
      return { to: "WAITING_PO" as const };
    }
    if (t.stage === "PAYMENT") {
      const paid = await tx.execute<{ n: number }>(sql`select count(*)::int as n from payments where invoice_id = ${t.invoice_id}`);
      if (paid.rows[0].n > 0) {
        throw new UserFacingError("Payments are already recorded against this invoice, so it can't be moved back to Billing.");
      }
      await tx.update(tickets).set({ stage: "BILLING", invoiceId: null, stageChangedAt: new Date() }).where(eq(tickets.id, ticketId));
      await addEvents(tx, [ticketId], "MOVED_BACK", `Moved back to Billing: ${reason}`, { from: "PAYMENT", to: "BILLING", invoiceId: t.invoice_id, reason });
      return { to: "BILLING" as const };
    }
    if (t.stage === "PAID") throw new UserFacingError("Paid services are closed and can't be moved back.");
    if (t.stage === "WAITING_PO") throw new UserFacingError("This is already the first step.");
    throw new UserFacingError("This ticket is cancelled.");
  });
}
