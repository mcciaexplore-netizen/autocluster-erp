/**
 * Every change to stock is a movement. This file is the only place stock changes.
 *
 * Rules enforced here:
 * - Each save is one numbered record (Stock received / used / adjusted) in one transaction.
 * - The affected item rows (and their batches) are locked (SELECT ... FOR UPDATE), in a fixed
 *   order, so stock can never go below zero, even when two people save at the same moment.
 * - Current quantity and average cost are kept on the item and batch rows, updated in the
 *   same transaction as the movement (fast reads; `npm run inv:verify` checks them).
 * - Values are saved on every movement, so job costs never change later.
 * - Records are never edited or deleted. "Reverse" creates an opposite, linked record.
 * Kept free of Next.js imports so scripts and tests can use it.
 */
import Decimal from "decimal.js";
import { and, asc, eq, sql } from "drizzle-orm";
import { applyIn, applyOut, applyOutAtCost, isExpired, pickBatches, usableBatches, type StockState } from "@/lib/inventory/calc";
import { D, formatQty, packRateToUnitRate, packsToUnits, parseQty, parseRate, qtyText, rateText, valuePaise } from "@/lib/inventory/numbers";
import { financialYear, formatQuoteNo } from "@/lib/pricing";
import { formatDate } from "@/lib/format";
import { todayInIndia } from "@/lib/tickets";
import type { DB, Tx } from "./client";
import { nextInvSeq } from "./inv-master-writer";
import { UserFacingError } from "./quote-writer";
import {
  files,
  invAdjustReasons,
  invBatches,
  invDocuments,
  invItems,
  invMovements,
  invPurposes,
  invSupplierItems,
  invSuppliers,
  invUnits,
  settings,
  teamMembers,
  tickets,
  type InvBatch,
  type InvDocType,
  type InvItem,
} from "./schema";

const ids = (list: string[]) => sql`any(${sql.param(list)}::uuid[])`;

type LockedItem = InvItem & { unit: string };

/** Locks the items (sorted by id, so two saves never wait on each other in a circle). */
async function lockItems(tx: Tx, itemIds: string[]): Promise<Map<string, LockedItem>> {
  const unique = [...new Set(itemIds)].sort();
  if (!unique.length) throw new UserFacingError("Please add at least one item.");
  const rows = await tx.select().from(invItems).where(sql`${invItems.id} = ${ids(unique)}`).orderBy(asc(invItems.id)).for("update");
  if (rows.length !== unique.length) throw new UserFacingError("One of the items could not be found. Please refresh the page.");
  const units = new Map((await tx.select().from(invUnits)).map((u) => [u.id, u.name]));
  return new Map(rows.map((r) => [r.id, { ...r, unit: units.get(r.unitId) ?? "" }]));
}

async function lockBatches(tx: Tx, itemIds: string[]): Promise<InvBatch[]> {
  const unique = [...new Set(itemIds)].sort();
  return tx.select().from(invBatches).where(sql`${invBatches.itemId} = ${ids(unique)}`).orderBy(asc(invBatches.id)).for("update");
}

async function newDocument(
  tx: Tx,
  type: InvDocType,
  fields: Partial<typeof invDocuments.$inferInsert> & { docDate: string },
): Promise<{ id: string; docNo: string }> {
  const [set] = await tx.select().from(settings).where(eq(settings.id, 1));
  const prefix = type === "IN" ? (set?.invInPrefix ?? "ACDRI/IN") : type === "OUT" ? (set?.invOutPrefix ?? "ACDRI/OUT") : (set?.invAdjPrefix ?? "ACDRI/ADJ");
  const fy = financialYear(new Date(`${fields.docDate}T00:00:00`));
  const seq = await nextInvSeq(tx, `${type}:${fy}`);
  const docNo = formatQuoteNo(prefix, fy, seq);
  const [d] = await tx
    .insert(invDocuments)
    .values({ ...fields, type, fy, seq, docNo })
    .returning({ id: invDocuments.id, docNo: invDocuments.docNo });
  return d;
}

async function checkDoneBy(tx: Tx, doneBy: string | null | undefined) {
  if (!doneBy) return null;
  const [m] = await tx.select({ id: teamMembers.id }).from(teamMembers).where(eq(teamMembers.id, doneBy));
  if (!m) throw new UserFacingError("That team member could not be found.");
  return m.id;
}

function checkDate(date: string | null | undefined, today: string, what: string) {
  if (!date) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new UserFacingError(`The ${what} doesn't look right.`);
  if (date > today) throw new UserFacingError(`The ${what} can't be in the future.`);
  return date;
}

/** Keeps each item's state while a record's lines are applied, then writes it back once. */
class Ledger {
  state = new Map<string, StockState>();
  batchQty = new Map<string, Decimal>();
  movements: (typeof invMovements.$inferInsert)[] = [];
  constructor(
    private items: Map<string, LockedItem>,
    batches: InvBatch[],
  ) {
    for (const i of items.values()) this.state.set(i.id, { qty: i.qtyOnHand, avg: i.avgCost });
    for (const b of batches) this.batchQty.set(b.id, D(b.qtyOnHand));
  }
  qty(itemId: string) {
    return D(this.state.get(itemId)!.qty);
  }
  avg(itemId: string) {
    return this.state.get(itemId)!.avg;
  }
  private push(docId: string, itemId: string, batchId: string | null, m: { qtyIn?: string; qtyOut?: string; unitCost: string; value: number; reasonId?: string | null; note?: string | null }) {
    if (batchId) {
      const cur = this.batchQty.get(batchId) ?? D(0);
      const next = cur.add(D(m.qtyIn ?? 0)).sub(D(m.qtyOut ?? 0));
      if (next.lt(0)) throw new UserFacingError("A batch can't go below zero. Please refresh the page and try again.");
      this.batchQty.set(batchId, next);
    }
    const s = this.state.get(itemId)!;
    if (D(s.qty).lt(0)) throw new UserFacingError("Stock can't go below zero.");
    this.movements.push({
      documentId: docId,
      itemId,
      batchId,
      qtyIn: qtyText(m.qtyIn ?? 0),
      qtyOut: qtyText(m.qtyOut ?? 0),
      unitCost: rateText(m.unitCost),
      value: m.value,
      reasonId: m.reasonId ?? null,
      note: m.note ?? null,
      balanceAfter: s.qty,
    });
  }
  in(docId: string, itemId: string, batchId: string | null, qty: string, unitCost: string, extra: { reasonId?: string | null; note?: string | null; value?: number } = {}) {
    this.state.set(itemId, applyIn(this.state.get(itemId)!, qty, unitCost));
    this.push(docId, itemId, batchId, { qtyIn: qty, unitCost, value: extra.value ?? valuePaise(qty, unitCost), reasonId: extra.reasonId, note: extra.note });
  }
  out(docId: string, itemId: string, batchId: string | null, qty: string, extra: { reasonId?: string | null; note?: string | null } = {}) {
    const avg = this.avg(itemId);
    this.state.set(itemId, applyOut(this.state.get(itemId)!, qty));
    this.push(docId, itemId, batchId, { qtyOut: qty, unitCost: avg, value: valuePaise(qty, avg), ...extra });
  }
  outAtCost(docId: string, itemId: string, batchId: string | null, qty: string, unitCost: string, value: number, note: string | null) {
    this.state.set(itemId, applyOutAtCost(this.state.get(itemId)!, qty, unitCost));
    this.push(docId, itemId, batchId, { qtyOut: qty, unitCost, value, note });
  }
  async save(tx: Tx) {
    for (const m of this.movements) await tx.insert(invMovements).values(m);
    for (const [id, s] of this.state) {
      if (D(s.qty).lt(0)) throw new UserFacingError(`Not enough stock of ${this.items.get(id)?.name ?? "an item"}.`);
      await tx.update(invItems).set({ qtyOnHand: s.qty, avgCost: s.avg }).where(eq(invItems.id, id));
    }
    for (const [id, q] of this.batchQty) await tx.update(invBatches).set({ qtyOnHand: qtyText(q) }).where(eq(invBatches.id, id));
  }
}

/** "Only 150 ml of SLA resin in stock. You entered 230 ml." */
function notEnough(item: LockedItem, have: Decimal.Value, asked: Decimal.Value) {
  return new UserFacingError(`Only ${formatQty(have, item.unit)} of ${item.name} in stock. You entered ${formatQty(asked, item.unit)}.`);
}

// ---- Stock received ----------------------------------------------------------------------------

export interface ReceiveLine {
  itemId: string;
  /** In units, or in packs when `inPacks` (e.g. 3 bottles). */
  qty: string;
  inPacks?: boolean;
  /** Rate before GST, per unit, or per pack when `ratePerPack`. */
  rate: string;
  ratePerPack?: boolean;
  batchNo?: string | null;
  expiryDate?: string | null;
}
export interface ReceiveInput {
  supplierId: string;
  supplierBillNo?: string | null;
  supplierBillDate?: string | null;
  fileId?: string | null;
  doneBy?: string | null;
  note?: string | null;
  docDate?: string;
  lines: ReceiveLine[];
}

export async function receiveStock(db: DB | Tx, input: ReceiveInput, opts: { today?: string } = {}) {
  const today = opts.today ?? todayInIndia();
  return db.transaction(async (tx) => {
    const [sup] = await tx.select().from(invSuppliers).where(eq(invSuppliers.id, input.supplierId));
    if (!sup) throw new UserFacingError("Please choose the supplier.");
    if (!input.lines.length) throw new UserFacingError("Please add at least one item.");
    const docDate = checkDate(input.docDate ?? today, today, "date")!;
    const billDate = checkDate(input.supplierBillDate, today, "bill date");
    if (input.fileId) {
      const [f] = await tx.select().from(files).where(eq(files.id, input.fileId));
      if (!f || f.kind !== "BILL") throw new UserFacingError("The uploaded bill could not be found. Please upload it again.");
    }
    const items = await lockItems(
      tx,
      input.lines.map((l) => l.itemId),
    );
    const batches = await lockBatches(tx, [...items.keys()]);
    const ledger = new Ledger(items, batches);
    const doc = await newDocument(tx, "IN", {
      docDate,
      supplierId: sup.id,
      supplierBillNo: input.supplierBillNo?.trim() || null,
      supplierBillDate: billDate,
      fileId: input.fileId || null,
      doneBy: await checkDoneBy(tx, input.doneBy),
      note: input.note?.trim() || null,
    });
    const lastRate = new Map<string, string>();
    for (const [n, l] of input.lines.entries()) {
      const item = items.get(l.itemId)!;
      const where = `Line ${n + 1} (${item.name})`;
      const entered = parseQty(l.qty);
      if (!entered || D(entered).lte(0)) throw new UserFacingError(`${where}: please enter the quantity received.`);
      const rate = parseRate(l.rate);
      if (rate == null) throw new UserFacingError(`${where}: please enter the rate before GST, e.g. 4.50.`);
      if ((l.inPacks || l.ratePerPack) && !(item.packSize && D(item.packSize).gt(0))) throw new UserFacingError(`${where}: this item has no pack size. Enter the quantity and rate per ${item.unit}.`);
      const qty = l.inPacks ? packsToUnits(entered, item.packSize!) : entered;
      if (parseQty(qtyText(qty)) == null || D(qty).gt(1e10)) throw new UserFacingError(`${where}: the quantity is too large.`);
      const unitRate = l.ratePerPack ? packRateToUnitRate(rate, item.packSize!) : rate;
      let batchId: string | null = null;
      if (item.trackBatches) {
        const batchNo = l.batchNo?.trim();
        if (!batchNo) throw new UserFacingError(`${where}: please enter the batch number.`);
        if (!l.expiryDate) throw new UserFacingError(`${where}: please enter the expiry date.`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(l.expiryDate)) throw new UserFacingError(`${where}: the expiry date doesn't look right.`);
        const existing = batches.find((b) => b.itemId === item.id && b.batchNo.toLowerCase() === batchNo.toLowerCase());
        if (existing) {
          if (existing.expiryDate !== l.expiryDate)
            throw new UserFacingError(`${where}: batch ${existing.batchNo} is already in stock with expiry ${existing.expiryDate ? formatDate(existing.expiryDate) : "not set"}. Check the batch number or the expiry date.`);
          batchId = existing.id;
        } else {
          const [b] = await tx.insert(invBatches).values({ itemId: item.id, batchNo, expiryDate: l.expiryDate, qtyOnHand: "0", receivedOn: docDate }).returning();
          batches.push(b);
          ledger.batchQty.set(b.id, D(0));
          batchId = b.id;
        }
      }
      ledger.in(doc.id, item.id, batchId, qtyText(qty), rateText(unitRate));
      lastRate.set(item.id, rateText(unitRate));
    }
    await ledger.save(tx);
    const rateDate = billDate ?? docDate;
    for (const [itemId, rate] of lastRate) {
      const item = items.get(itemId)!;
      // The "Ordered on" marker clears when stock arrives from the supplier it was ordered from.
      const clear = item.orderedOn && (!item.orderedSupplierId || item.orderedSupplierId === sup.id);
      await tx
        .update(invItems)
        .set({ lastPurchaseRate: rate, ...(clear ? { orderedOn: null, orderedSupplierId: null } : {}) })
        .where(eq(invItems.id, itemId));
      await tx
        .insert(invSupplierItems)
        .values({ supplierId: sup.id, itemId, lastRate: rate, lastRateDate: rateDate })
        .onConflictDoUpdate({
          target: [invSupplierItems.supplierId, invSupplierItems.itemId],
          set: { lastRate: rate, lastRateDate: rateDate },
          setWhere: sql`${invSupplierItems.lastRateDate} is null or ${invSupplierItems.lastRateDate} <= ${rateDate}`,
        });
    }
    return { id: doc.id, docNo: doc.docNo, lines: ledger.movements.length };
  });
}

// ---- Use stock -----------------------------------------------------------------------------------

export interface UseLine {
  itemId: string;
  qty: string;
  /** Leave empty to use the batch that expires first (split over batches if needed). */
  batchId?: string | null;
}
export interface UseInput {
  ticketId?: string | null;
  purposeId?: string | null;
  doneBy?: string | null;
  note?: string | null;
  docDate?: string;
  lines: UseLine[];
}

export async function issueStock(db: DB | Tx, input: UseInput, opts: { today?: string } = {}) {
  const today = opts.today ?? todayInIndia();
  return db.transaction(async (tx) => {
    if (!!input.ticketId === !!input.purposeId) throw new UserFacingError("Please choose what the stock is for: a job, or internal use.");
    const note = input.note?.trim() || null;
    if (input.ticketId) {
      const [t] = await tx.select({ id: tickets.id, stage: tickets.stage }).from(tickets).where(eq(tickets.id, input.ticketId));
      if (!t) throw new UserFacingError("That job (ticket) could not be found.");
      if (t.stage === "CANCELLED") throw new UserFacingError("That ticket is cancelled. Choose another job, or use “Internal use”.");
    } else {
      const [p] = await tx.select().from(invPurposes).where(eq(invPurposes.id, input.purposeId!));
      if (!p) throw new UserFacingError("Please choose the purpose.");
      if (p.name.toLowerCase() === "other" && !note) throw new UserFacingError("Please write a short note about what the stock was used for.");
    }
    const docDate = checkDate(input.docDate ?? today, today, "date")!;
    const items = await lockItems(
      tx,
      input.lines.map((l) => l.itemId),
    );
    const batches = await lockBatches(tx, [...items.keys()]);
    // Enough stock for every item (lines of the same item added together)?
    const asked = new Map<string, Decimal>();
    for (const [n, l] of input.lines.entries()) {
      const item = items.get(l.itemId)!;
      const q = parseQty(l.qty);
      if (!q || D(q).lte(0)) throw new UserFacingError(`Line ${n + 1} (${item.name}): please enter the quantity used.`);
      asked.set(item.id, (asked.get(item.id) ?? D(0)).add(D(q)));
    }
    for (const [itemId, q] of asked) {
      const item = items.get(itemId)!;
      if (q.gt(D(item.qtyOnHand))) throw notEnough(item, item.qtyOnHand, q);
      if (item.trackBatches) {
        const mine = batches.filter((b) => b.itemId === itemId).map((b) => ({ ...b, qty: b.qtyOnHand }));
        const usable = usableBatches(mine, today).reduce((a, b) => a.add(D(b.qty)), D(0));
        if (q.gt(usable)) {
          const expired = mine.filter((b) => D(b.qty).gt(0) && isExpired(b, today));
          throw new UserFacingError(
            `Only ${formatQty(usable, item.unit)} of ${item.name} can be used. You entered ${formatQty(q, item.unit)}.` +
              (expired.length ? ` ${expired.length} expired ${expired.length === 1 ? "batch" : "batches"}, adjust ${expired.length === 1 ? "it" : "them"} out instead.` : ""),
          );
        }
      }
    }
    const ledger = new Ledger(items, batches);
    const doc = await newDocument(tx, "OUT", {
      docDate,
      ticketId: input.ticketId || null,
      purposeId: input.purposeId || null,
      doneBy: await checkDoneBy(tx, input.doneBy),
      note,
    });
    for (const [n, l] of input.lines.entries()) {
      const item = items.get(l.itemId)!;
      const q = parseQty(l.qty)!;
      if (!item.trackBatches) {
        ledger.out(doc.id, item.id, null, q);
        continue;
      }
      const mine = batches.filter((b) => b.itemId === item.id).map((b) => ({ ...b, qty: ledger.batchQty.get(b.id)!.toFixed() }));
      if (l.batchId) {
        const b = mine.find((x) => x.id === l.batchId);
        if (!b) throw new UserFacingError(`Line ${n + 1} (${item.name}): that batch could not be found.`);
        if (isExpired(b, today)) throw new UserFacingError(`Line ${n + 1} (${item.name}): batch ${b.batchNo} has expired. Adjust it out instead.`);
        if (D(q).gt(D(b.qty))) throw new UserFacingError(`Line ${n + 1} (${item.name}): batch ${b.batchNo} has only ${formatQty(b.qty, item.unit)}.`);
        ledger.out(doc.id, item.id, b.id, q);
      } else {
        const picks = pickBatches(mine, q, today);
        if (!picks) throw notEnough(item, ledger.qty(item.id), q);
        for (const p of picks) ledger.out(doc.id, item.id, p.batch.id, qtyText(p.qty));
      }
    }
    await ledger.save(tx);
    const value = ledger.movements.reduce((a, m) => a + (m.value ?? 0), 0);
    return { id: doc.id, docNo: doc.docNo, valuePaise: value };
  });
}

// ---- Adjust stock --------------------------------------------------------------------------------

export interface AdjustLine {
  itemId: string;
  direction: "ADD" | "REMOVE";
  qty: string;
  reasonId: string;
  /** An existing batch (needed when the item tracks batches, unless a new batch is given for ADD). */
  batchId?: string | null;
  newBatchNo?: string | null;
  newExpiryDate?: string | null;
}
export interface AdjustInput {
  doneBy?: string | null;
  note: string;
  docDate?: string;
  lines: AdjustLine[];
}

export async function adjustStock(db: DB | Tx, input: AdjustInput, opts: { today?: string } = {}) {
  const today = opts.today ?? todayInIndia();
  return db.transaction(async (tx) => {
    const note = input.note?.trim();
    if (!note || note.length < 3) throw new UserFacingError("Please write a short note about why the stock is being adjusted.");
    const docDate = checkDate(input.docDate ?? today, today, "date")!;
    const reasons = new Map((await tx.select().from(invAdjustReasons)).map((r) => [r.id, r]));
    const items = await lockItems(
      tx,
      input.lines.map((l) => l.itemId),
    );
    const batches = await lockBatches(tx, [...items.keys()]);
    const ledger = new Ledger(items, batches);
    const doc = await newDocument(tx, "ADJ", { docDate, doneBy: await checkDoneBy(tx, input.doneBy), note });
    for (const [n, l] of input.lines.entries()) {
      const item = items.get(l.itemId)!;
      const where = `Line ${n + 1} (${item.name})`;
      const q = parseQty(l.qty);
      if (!q || D(q).lte(0)) throw new UserFacingError(`${where}: please enter the quantity.`);
      if (!reasons.has(l.reasonId)) throw new UserFacingError(`${where}: please choose the reason.`);
      let batchId: string | null = null;
      if (item.trackBatches) {
        if (l.batchId) {
          const b = batches.find((x) => x.id === l.batchId && x.itemId === item.id);
          if (!b) throw new UserFacingError(`${where}: that batch could not be found.`);
          batchId = b.id;
        } else if (l.direction === "ADD" && l.newBatchNo?.trim()) {
          if (!l.newExpiryDate) throw new UserFacingError(`${where}: please enter the expiry date of the new batch.`);
          const no = l.newBatchNo.trim();
          if (batches.some((x) => x.itemId === item.id && x.batchNo.toLowerCase() === no.toLowerCase())) throw new UserFacingError(`${where}: batch ${no} already exists. Choose it from the list instead.`);
          const [b] = await tx.insert(invBatches).values({ itemId: item.id, batchNo: no, expiryDate: l.newExpiryDate, qtyOnHand: "0", receivedOn: docDate }).returning();
          batches.push(b);
          ledger.batchQty.set(b.id, D(0));
          batchId = b.id;
        } else throw new UserFacingError(`${where}: please choose the batch.`);
      }
      if (l.direction === "REMOVE") {
        if (D(q).gt(ledger.qty(item.id))) throw notEnough(item, ledger.qty(item.id), q);
        if (batchId && D(q).gt(ledger.batchQty.get(batchId)!)) {
          const b = batches.find((x) => x.id === batchId)!;
          throw new UserFacingError(`${where}: batch ${b.batchNo} has only ${formatQty(ledger.batchQty.get(batchId)!, item.unit)}.`);
        }
        ledger.out(doc.id, item.id, batchId, q, { reasonId: l.reasonId });
      } else {
        // Found stock is added at the current average cost, so the average doesn't change.
        ledger.in(doc.id, item.id, batchId, q, ledger.avg(item.id), { reasonId: l.reasonId });
      }
    }
    await ledger.save(tx);
    return { id: doc.id, docNo: doc.docNo };
  });
}

// ---- Reverse a record ------------------------------------------------------------------------------

/**
 * Creates the opposite record, linked to the original, so stock and value go back exactly.
 * A reversal can't itself be reversed, and a record can only be reversed once.
 */
export async function reverseDocument(db: DB | Tx, docId: string, reason: string, opts: { doneBy?: string | null; today?: string } = {}) {
  const today = opts.today ?? todayInIndia();
  return db.transaction(async (tx) => {
    const why = reason.trim();
    if (why.length < 3) throw new UserFacingError("Please write a short reason, e.g. “Wrong quantity entered”.");
    const [orig] = await tx.select().from(invDocuments).where(eq(invDocuments.id, docId)).for("update");
    if (!orig) throw new UserFacingError("This record could not be found.");
    if (orig.reversesDocId) throw new UserFacingError("This record is itself a reversal, so it can't be reversed. Enter the record again instead.");
    if (orig.reversedByDocId) throw new UserFacingError("This record has already been reversed.");
    const moves = await tx.select().from(invMovements).where(eq(invMovements.documentId, docId)).orderBy(asc(invMovements.id));
    const items = await lockItems(
      tx,
      moves.map((m) => m.itemId),
    );
    const batches = await lockBatches(tx, [...items.keys()]);
    const ledger = new Ledger(items, batches);
    const doc = await newDocument(tx, orig.type, {
      docDate: today,
      supplierId: orig.supplierId,
      ticketId: orig.ticketId,
      purposeId: orig.purposeId,
      reversesDocId: orig.id,
      doneBy: await checkDoneBy(tx, opts.doneBy),
      note: `Reversal of ${orig.docNo}: ${why}`,
    });
    for (const m of moves) {
      const item = items.get(m.itemId)!;
      if (D(m.qtyIn).gt(0)) {
        // It came in: take the same quantity out at the rate it came in at.
        const have = ledger.qty(item.id);
        if (D(m.qtyIn).gt(have))
          throw new UserFacingError(`Some of this ${item.name} has already been used, so the record can't be reversed (only ${formatQty(have, item.unit)} left). Use “Adjust stock” instead.`);
        if (m.batchId && D(m.qtyIn).gt(ledger.batchQty.get(m.batchId) ?? D(0))) {
          const b = batches.find((x) => x.id === m.batchId)!;
          throw new UserFacingError(`Some of batch ${b.batchNo} of ${item.name} has already been used, so the record can't be reversed. Use “Adjust stock” instead.`);
        }
        ledger.outAtCost(doc.id, item.id, m.batchId, m.qtyIn, m.unitCost, m.value, null);
      } else {
        // It went out: put it back at the value it went out at.
        ledger.in(doc.id, item.id, m.batchId, m.qtyOut, m.unitCost, { value: m.value });
      }
    }
    await ledger.save(tx);
    await tx.update(invDocuments).set({ reversedByDocId: doc.id }).where(eq(invDocuments.id, orig.id));
    return { id: doc.id, docNo: doc.docNo, reversed: orig.docNo };
  });
}

// ---- helpers for screens -----------------------------------------------------------------------

/** Batches that can be used now (for the Use stock form), the one that expires first first. */
export async function batchesForUse(db: DB | Tx, itemId: string, today: string = todayInIndia()) {
  const rows = await db.select().from(invBatches).where(and(eq(invBatches.itemId, itemId)));
  const mapped = rows.map((b) => ({ ...b, qty: b.qtyOnHand }));
  return { usable: usableBatches(mapped, today), expired: mapped.filter((b) => D(b.qty).gt(0) && isExpired(b, today)) };
}
