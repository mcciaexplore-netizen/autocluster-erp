/** Insights calculations (brief section 9). Pure and unit-tested. Dates are India dates (YYYY-MM-DD). */
import { D } from "./numbers";
import { addDays } from "@/lib/tickets";

export interface Receipt {
  date: string;
  rate: string;
}

/**
 * Purchase rate change for one item: the latest delivery up to the end of the period, compared
 * with the last delivery before the period (or, if none, the first delivery in it).
 * Returns null when there's nothing to compare or the rise isn't more than the alert %.
 */
export function priceRise(receipts: Receipt[], from: string, to: string, alertPct: number): { old: Receipt; latest: Receipt; risePct: number } | null {
  const rs = receipts.filter((r) => r.date <= to).sort((a, b) => a.date.localeCompare(b.date));
  const latest = rs.at(-1);
  if (!latest || latest.date < from) return null; // no delivery in the period
  const old = rs.filter((r) => r.date < from).at(-1) ?? rs.find((r) => r.date >= from && r.date < latest.date);
  if (!old || D(old.rate).lte(0)) return null;
  const risePct = D(latest.rate).div(D(old.rate)).sub(1).mul(100).toNumber();
  return risePct > alertPct ? { old, latest, risePct } : null;
}

/** Slow-moving: in stock and not used in the last `days` days (never used counts too). */
export function isSlowMoving(p: { qty: string; lastUsed: string | null }, today: string, days: number): boolean {
  if (!D(p.qty).gt(0)) return false;
  return !p.lastUsed || p.lastUsed <= addDays(today, -days);
}
