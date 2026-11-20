/**
 * Inventory calculations (brief section 9). Pure and unit-tested. Used by the stock writer,
 * the screens, and `npm run inv:verify`, so they always agree.
 */
import Decimal from "decimal.js";
import { daysBetween } from "@/lib/tickets";
import { D } from "./numbers";

export interface StockState {
  qty: string; // 3 decimals
  avg: string; // 4 decimals, rupees per unit
}

const q3 = (d: Decimal) => d.toDecimalPlaces(3, Decimal.ROUND_HALF_UP);
const r4 = (d: Decimal) => d.toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
const out = (qty: Decimal, avg: Decimal): StockState => ({ qty: q3(qty).toFixed(3), avg: r4(avg).toFixed(4) });

/**
 * Stock coming in at a unit cost (a receipt, stock added back, a use being reversed).
 * new average = (current qty x current average + received qty x rate) / (current qty + received qty)
 */
export function applyIn(s: StockState, qty: Decimal.Value, unitCost: Decimal.Value): StockState {
  const q = D(s.qty);
  const add = D(qty);
  const total = q.add(add);
  if (total.lte(0)) return out(total, D(s.avg));
  return out(total, q.mul(D(s.avg)).add(add.mul(D(unitCost))).div(total));
}

/** Stock used or removed: valued at the average at that moment; the average doesn't change. */
export function applyOut(s: StockState, qty: Decimal.Value): StockState {
  return out(D(s.qty).sub(D(qty)), D(s.avg));
}

/**
 * Taking back a receipt (its reversal): the delivery leaves at the rate it came in at,
 * so stock and value return to what they were before it arrived.
 */
export function applyOutAtCost(s: StockState, qty: Decimal.Value, unitCost: Decimal.Value): StockState {
  const q = D(s.qty);
  const left = q.sub(D(qty));
  if (left.lte(0)) return out(left, D(s.avg));
  const value = q.mul(D(s.avg)).sub(D(qty).mul(D(unitCost)));
  return out(left, Decimal.max(value, 0).div(left));
}

/** Average daily use = quantity used in the last N days / N. */
export function averageDailyUse(usedQty: Decimal.Value, days: number): number {
  if (days <= 0) return 0;
  return D(usedQty).div(days).toNumber();
}

/** Runs out in (days) = current qty / average daily use. null = no recent use. 0 = out of stock. */
export function runsOutInDays(qty: Decimal.Value, dailyUse: number): number | null {
  if (D(qty).lte(0)) return 0;
  if (!(dailyUse > 0)) return null;
  return D(qty).div(dailyUse).toNumber();
}

/**
 * Order now when stock is at or below the reorder level, or it will run out before
 * new stock can arrive (runs out in <= lead time + safety days).
 */
export function shouldOrder(p: { qty: Decimal.Value; reorderLevel: Decimal.Value; runsOutDays: number | null; leadTimeDays: number | null; safetyDays: number }): boolean {
  if (D(p.qty).lte(D(p.reorderLevel))) return true;
  if (p.runsOutDays == null) return false;
  return p.runsOutDays <= (p.leadTimeDays ?? 0) + p.safetyDays;
}

export interface BatchLike {
  id: string;
  batchNo: string;
  expiryDate: string | null;
  qty: string;
}

export const isExpired = (b: { expiryDate: string | null }, today: string) => !!b.expiryDate && daysBetween(today, b.expiryDate) < 0;

/** Batches that can be used: in stock and not expired, the one that expires first first (no expiry last). */
export function usableBatches<T extends BatchLike>(batches: T[], today: string): T[] {
  return batches
    .filter((b) => D(b.qty).gt(0) && !isExpired(b, today))
    .sort((a, b) => (a.expiryDate ?? "9999-12-31").localeCompare(b.expiryDate ?? "9999-12-31") || a.batchNo.localeCompare(b.batchNo));
}

/**
 * Uses the batch that expires first, then the next, until the quantity is covered.
 * Returns null when the usable batches don't hold enough.
 */
export function pickBatches<T extends BatchLike>(batches: T[], need: Decimal.Value, today: string): { batch: T; qty: string }[] | null {
  let left = D(need);
  const picks: { batch: T; qty: string }[] = [];
  for (const b of usableBatches(batches, today)) {
    if (left.lte(0)) break;
    const take = Decimal.min(left, D(b.qty));
    picks.push({ batch: b, qty: q3(take).toFixed() });
    left = left.sub(take);
  }
  return left.gt(0) ? null : picks;
}
