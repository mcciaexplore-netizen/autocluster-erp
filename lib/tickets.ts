/**
 * Orders & Billing: pure rules (no database), shared by the server and the browser.
 * Money is integer paise, like everywhere else.
 */
import Decimal from "decimal.js";
import { formatINR, lineAmount, toPaise } from "./pricing";

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------

export const STAGES = ["WAITING_PO", "BILLING", "PAYMENT", "PAID"] as const;
export type BoardStage = (typeof STAGES)[number];
export type Stage = BoardStage | "CANCELLED";

export const STAGE_INFO: Record<BoardStage, { title: string; help: string; short: string }> = {
  WAITING_PO: { title: "Waiting for PO", help: "Services accepted, PO not received yet", short: "Waiting for PO" },
  BILLING: { title: "Billing", help: "PO received, invoice not made yet", short: "Billing" },
  PAYMENT: { title: "Payment follow-up", help: "Invoice sent, payment pending", short: "Payment" },
  PAID: { title: "Paid", help: "Payment received in full", short: "Paid" },
};

export function stageIndex(s: Stage): number {
  return STAGES.indexOf(s as BoardStage);
}

/** A card can only move one step forward or one step back. Paid and cancelled cards don't move. */
export function moveKind(from: Stage, to: Stage): "forward" | "back" | "invalid" {
  if (from === "CANCELLED" || to === "CANCELLED" || from === "PAID") return "invalid";
  const a = stageIndex(from);
  const b = stageIndex(to);
  if (a < 0 || b < 0) return "invalid";
  if (b === a + 1) return "forward";
  if (b === a - 1) return "back";
  return "invalid";
}

/** Plain-words reason a move is not allowed, or null. */
export function moveProblem(from: Stage, to: Stage): string | null {
  if (from === to) return null;
  if (from === "PAID") return "Paid services are closed and can't be moved.";
  if (from === "CANCELLED") return "This ticket is cancelled.";
  const kind = moveKind(from, to);
  if (kind !== "invalid") return null;
  const target = to === "CANCELLED" ? "Cancelled" : STAGE_INFO[to as BoardStage].title;
  return stageIndex(to) > stageIndex(from)
    ? `A card can't skip a step. Finish “${STAGE_INFO[STAGES[stageIndex(from) + 1]].title}” first.`
    : `Move it back one step at a time, to “${STAGE_INFO[STAGES[stageIndex(from) - 1]].title}” first, not straight to “${target}”.`;
}

// ---------------------------------------------------------------------------
// Splitting a quotation into tickets
// ---------------------------------------------------------------------------

export interface QuoteForSplit {
  intraState: boolean;
  gstPct: number;
  /** Paise, as saved on the quotation. */
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  grandTotalPaise: number;
}

export interface LineForSplit {
  billableQty: number;
  listRatePaise: number;
  /** Taxable amount of the line (after any member discount), as saved. */
  amountPaise: number;
}

export interface TicketValue {
  listPaise: number;
  discountPaise: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  roundOffPaise: number;
  totalPaise: number;
}

function pctOf(paise: number, pct: number): number {
  return new Decimal(paise).times(pct).dividedBy(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

/**
 * One value per quotation line. Each line gets its own GST, worked out the same way as
 * the quotation. Any rounding difference (GST paise and the quotation's round off) goes on
 * the LAST ticket, so the tickets always add up exactly to the quotation.
 */
export function splitQuotation(q: QuoteForSplit, lines: LineForSplit[]): TicketValue[] {
  if (!lines.length) return [];
  const half = new Decimal(q.gstPct).dividedBy(2).toNumber();
  const values: TicketValue[] = lines.map((l) => {
    const listPaise = lineAmount(l.billableQty, l.listRatePaise);
    const taxablePaise = l.amountPaise;
    const cgstPaise = q.intraState ? pctOf(taxablePaise, half) : 0;
    const sgstPaise = q.intraState ? pctOf(taxablePaise, half) : 0;
    const igstPaise = q.intraState ? 0 : pctOf(taxablePaise, q.gstPct);
    return {
      listPaise,
      discountPaise: listPaise - taxablePaise,
      taxablePaise,
      cgstPaise,
      sgstPaise,
      igstPaise,
      roundOffPaise: 0,
      totalPaise: taxablePaise + cgstPaise + sgstPaise + igstPaise,
    };
  });
  const last = values[values.length - 1];
  const others = values.slice(0, -1);
  const sum = (k: keyof TicketValue) => others.reduce((s, v) => s + v[k], 0);
  last.cgstPaise = q.cgstPaise - sum("cgstPaise");
  last.sgstPaise = q.sgstPaise - sum("sgstPaise");
  last.igstPaise = q.igstPaise - sum("igstPaise");
  const beforeRound = last.taxablePaise + last.cgstPaise + last.sgstPaise + last.igstPaise;
  last.totalPaise = q.grandTotalPaise - sum("totalPaise");
  last.roundOffPaise = last.totalPaise - beforeRound;
  return values;
}

// ---------------------------------------------------------------------------
// Dates (India time)
// ---------------------------------------------------------------------------

const indiaDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });

/** Today's date in India (Asia/Kolkata) as YYYY-MM-DD, whatever the server's time zone. */
export function todayInIndia(now: Date = new Date()): string {
  return indiaDate.format(now);
}

/** Whole days from a to b (YYYY-MM-DD). Positive when b is later. */
export function daysBetween(a: string, b: string): number {
  const ms = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10));
  return Math.round(ms / 86_400_000);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + days));
  return d.toISOString().slice(0, 10);
}

/** "4 days in this step" from when the card entered its column. */
export function daysInStep(stageChangedAt: Date | string, now: Date = new Date()): number {
  return Math.max(0, daysBetween(todayInIndia(new Date(stageChangedAt)), todayInIndia(now)));
}

export function daysInStepLabel(days: number): string {
  if (days === 0) return "Moved here today";
  return `${days} ${days === 1 ? "day" : "days"} in this step`;
}

// ---------------------------------------------------------------------------
// Invoice balance and due status
// ---------------------------------------------------------------------------

export interface InvoiceBalanceInput {
  amountPaise: number;
  payments: { amountPaise: number; tdsPaise: number }[];
}

/** Amount left = invoice amount - payments - TDS. Never below zero. */
export function amountLeft(inv: InvoiceBalanceInput): number {
  const paid = inv.payments.reduce((s, p) => s + p.amountPaise + p.tdsPaise, 0);
  return Math.max(0, inv.amountPaise - paid);
}

/** Plain-words problem with a payment, or null when it can be saved. */
export function paymentProblem(leftPaise: number, amountPaise: number, tdsPaise: number): string | null {
  if (!(amountPaise > 0) && !(tdsPaise > 0)) return "Please enter the amount received.";
  if (amountPaise < 0 || tdsPaise < 0) return "Amounts can't be negative.";
  if (amountPaise + tdsPaise > leftPaise) {
    return `This is more than the amount left (${formatINR(leftPaise)}). Please check the amount and TDS.`;
  }
  return null;
}

export type ChipTone = "grey" | "amber" | "red" | "blue" | "green";
export interface StatusChip {
  label: string;
  tone: ChipTone;
}

/** Due status for an unpaid invoice, in India time. */
export function dueChip(dueDate: string, today: string = todayInIndia()): StatusChip & { daysOverdue: number } {
  const d = daysBetween(today, dueDate);
  if (d > 0) return { label: `Due in ${d} ${d === 1 ? "day" : "days"}`, tone: "grey", daysOverdue: 0 };
  if (d === 0) return { label: "Due today", tone: "amber", daysOverdue: 0 };
  return { label: `Overdue by ${-d} ${d === -1 ? "day" : "days"}`, tone: "red", daysOverdue: -d };
}

/** Status chips for an invoice. Without amounts (hidden from this person), `balanceDue` gives the status. */
export function invoiceChips(inv: { dueDate: string; amountPaise: number | null; leftPaise: number | null; balanceDue?: boolean }, today: string = todayInIndia()): StatusChip[] {
  if (!hasBalance(inv)) return [{ label: "Paid", tone: "green" }];
  const chips: StatusChip[] = [dueChip(inv.dueDate, today)];
  if (inv.leftPaise != null && inv.amountPaise != null && inv.leftPaise < inv.amountPaise) chips.push({ label: `Part paid: ${formatINR(inv.leftPaise).replace(/\.00$/, "")} left`, tone: "blue" });
  return chips;
}

/**
 * "Follow-up due today": the next follow-up date is today or earlier, OR the invoice
 * is overdue and nobody has added a note or sent a reminder in the last 7 days.
 */
/** Is anything still to be paid? Uses the amount when it is shown, otherwise the balanceDue flag. */
export function hasBalance(inv: { leftPaise: number | null; balanceDue?: boolean }): boolean {
  return inv.leftPaise != null ? inv.leftPaise > 0 : !!inv.balanceDue;
}

export function followUpDue(
  inv: { dueDate: string; leftPaise: number | null; balanceDue?: boolean; nextFollowUpDate: string | null; lastContactDate: string | null },
  today: string = todayInIndia(),
): boolean {
  if (!hasBalance(inv)) return false;
  if (inv.nextFollowUpDate && inv.nextFollowUpDate <= today) return true;
  const overdue = inv.dueDate < today;
  const recent = inv.lastContactDate != null && daysBetween(inv.lastContactDate, today) < 7;
  return overdue && !recent;
}

// ---------------------------------------------------------------------------
// Purchase order amount check
// ---------------------------------------------------------------------------

/** True when the PO amount matches the selected services before or with GST (within ₹1). */
export function poAmountMatches(poPaise: number, beforeGstPaise: number, withGstPaise: number): boolean {
  return Math.abs(poPaise - beforeGstPaise) <= 100 || Math.abs(poPaise - withGstPaise) <= 100;
}

export { toPaise };
