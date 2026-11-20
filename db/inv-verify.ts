/**
 * Recalculates all stock from the movements and compares it with what is stored
 * (item and batch quantities, average cost, running balances, saved values).
 * Returns every difference in plain words; an empty list means everything matches.
 */
import Decimal from "decimal.js";
import { asc, eq } from "drizzle-orm";
import { applyIn, applyOut, applyOutAtCost, type StockState } from "@/lib/inventory/calc";
import { D, formatQty, valuePaise } from "@/lib/inventory/numbers";
import type { DB, Tx } from "./client";
import { invBatches, invDocuments, invItems, invMovements, invUnits } from "./schema";

export async function verifyInventory(db: DB | Tx): Promise<string[]> {
  const problems: string[] = [];
  const items = await db.select({ i: invItems, unit: invUnits.name }).from(invItems).innerJoin(invUnits, eq(invUnits.id, invItems.unitId));
  const docs = new Map((await db.select({ id: invDocuments.id, docNo: invDocuments.docNo, reverses: invDocuments.reversesDocId }).from(invDocuments)).map((d) => [d.id, d]));
  const moves = await db.select().from(invMovements).orderBy(asc(invMovements.id));
  const batches = await db.select().from(invBatches);
  const state = new Map<string, StockState>();
  const batchQty = new Map<string, Decimal>();
  const name = new Map(items.map(({ i, unit }) => [i.id, { name: `${i.name} (${i.code})`, unit }]));
  for (const m of moves) {
    const s = state.get(m.itemId) ?? { qty: "0", avg: "0" };
    const doc = docs.get(m.documentId);
    const who = `${name.get(m.itemId)?.name ?? "An item"} on ${doc?.docNo ?? "a record"}`;
    let next: StockState;
    if (D(m.qtyIn).gt(0)) {
      next = applyIn(s, m.qtyIn, m.unitCost);
    } else if (doc?.reverses) {
      next = applyOutAtCost(s, m.qtyOut, m.unitCost);
    } else {
      if (!D(m.unitCost).eq(D(s.avg))) problems.push(`${who}: used at ₹${m.unitCost} per unit, but the average cost then was ₹${s.avg}.`);
      if (m.value !== valuePaise(m.qtyOut, m.unitCost)) problems.push(`${who}: the saved value doesn't match quantity x cost.`);
      next = applyOut(s, m.qtyOut);
    }
    if (D(next.qty).lt(0)) problems.push(`${who}: stock went below zero.`);
    if (!D(next.qty).eq(D(m.balanceAfter))) problems.push(`${who}: the running balance says ${m.balanceAfter} but should be ${next.qty}.`);
    state.set(m.itemId, next);
    if (m.batchId) {
      const b = (batchQty.get(m.batchId) ?? D(0)).add(D(m.qtyIn)).sub(D(m.qtyOut));
      if (b.lt(0)) problems.push(`${who}: a batch went below zero.`);
      batchQty.set(m.batchId, b);
    }
  }
  for (const { i, unit } of items) {
    const s = state.get(i.id) ?? { qty: "0", avg: "0" };
    if (!D(s.qty).eq(D(i.qtyOnHand))) problems.push(`${i.name} (${i.code}): stock shows ${formatQty(i.qtyOnHand, unit)}, but the movements add up to ${formatQty(s.qty, unit)}.`);
    if (D(s.qty).gt(0) && !D(s.avg).eq(D(i.avgCost))) problems.push(`${i.name} (${i.code}): average cost shows ₹${i.avgCost}, but the movements give ₹${s.avg}.`);
    const inBatches = batches.filter((b) => b.itemId === i.id).reduce((a, b) => a.add(D(b.qtyOnHand)), D(0));
    if (i.trackBatches && !inBatches.eq(D(i.qtyOnHand))) problems.push(`${i.name} (${i.code}): batches hold ${formatQty(inBatches, unit)}, but the item shows ${formatQty(i.qtyOnHand, unit)}.`);
  }
  for (const b of batches) {
    const q = batchQty.get(b.id) ?? D(0);
    if (!q.eq(D(b.qtyOnHand))) problems.push(`${name.get(b.itemId)?.name ?? "An item"}, batch ${b.batchNo}: shows ${b.qtyOnHand}, but the movements add up to ${q.toFixed(3)}.`);
  }
  return problems;
}
