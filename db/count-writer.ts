/**
 * Stock counts (brief section 7): start a count (freezing each item's quantity), save counted
 * quantities as staff go, or discard an open count. Completing a count changes stock, so it
 * lives in stock-writer.ts (`completeCount`). Kept free of Next.js imports.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { formatQuoteNo, financialYear } from "@/lib/pricing";
import { D, parseQty } from "@/lib/inventory/numbers";
import { todayInIndia } from "@/lib/tickets";
import type { DB, Tx } from "./client";
import { nextInvSeq } from "./inv-master-writer";
import { UserFacingError } from "./quote-writer";
import { departments, invBatches, invCategories, invCountLines, invCounts, invItemDepartments, invItems, settings, teamMembers } from "./schema";

export interface CountScope {
  categoryId?: string | null;
  deptCode?: string | null;
}

/** Count numbers follow the adjustment prefix: ACDRI/ADJ -> ACDRI/CNT/2026-27/0001. */
export const countPrefix = (adjPrefix: string | null | undefined) => (adjPrefix || "ACDRI/ADJ").replace(/[^/]+$/, "CNT");

export async function startCount(db: DB | Tx, input: CountScope & { doneBy?: string | null }, opts: { today?: string } = {}) {
  const today = opts.today ?? todayInIndia();
  return db.transaction(async (tx) => {
    // One count at a time, so two counts never adjust the same stock twice.
    await tx.execute(sql`select pg_advisory_xact_lock(4242102)`);
    const [open] = await tx.select({ countNo: invCounts.countNo }).from(invCounts).where(eq(invCounts.status, "IN_PROGRESS")).limit(1);
    if (open) throw new UserFacingError(`Count ${open.countNo} is still open. Complete or discard it before starting another.`);

    let label = "All items";
    const where = [sql`(${invItems.isActive} or ${invItems.qtyOnHand} > 0)`];
    if (input.categoryId) {
      const [c] = await tx.select({ name: invCategories.name }).from(invCategories).where(eq(invCategories.id, input.categoryId));
      if (!c) throw new UserFacingError("That category could not be found.");
      label = `Category: ${c.name}`;
      where.push(eq(invItems.categoryId, input.categoryId));
    } else if (input.deptCode) {
      const [d] = await tx.select({ name: departments.name }).from(departments).where(eq(departments.code, input.deptCode));
      if (!d) throw new UserFacingError("That department could not be found.");
      label = `Department: ${d.name}`;
      where.push(sql`exists(select 1 from ${invItemDepartments} where ${invItemDepartments.itemId} = ${invItems.id} and ${invItemDepartments.deptCode} = ${input.deptCode})`);
    }
    let doneBy: string | null = null;
    if (input.doneBy) {
      const [m] = await tx.select({ id: teamMembers.id }).from(teamMembers).where(eq(teamMembers.id, input.doneBy));
      if (!m) throw new UserFacingError("That team member could not be found.");
      doneBy = m.id;
    }

    // Lock the items while their quantities are frozen, so nothing moves half-way through.
    const items = await tx
      .select({ id: invItems.id, qty: invItems.qtyOnHand, track: invItems.trackBatches })
      .from(invItems)
      .where(and(...where))
      .orderBy(asc(invItems.id))
      .for("update");
    if (!items.length) throw new UserFacingError("There are no items to count with this choice.");
    const batches = await tx
      .select()
      .from(invBatches)
      .where(sql`${invBatches.itemId} = any(${sql.param(items.filter((i) => i.track).map((i) => i.id))}::uuid[]) and ${invBatches.qtyOnHand} > 0`)
      .orderBy(asc(invBatches.id))
      .for("update");

    const [set] = await tx.select({ p: settings.invAdjPrefix }).from(settings).where(eq(settings.id, 1));
    const fy = financialYear(new Date(`${today}T00:00:00`));
    const countNo = formatQuoteNo(countPrefix(set?.p), fy, await nextInvSeq(tx, `CNT:${fy}`));
    const [count] = await tx.insert(invCounts).values({ countNo, filter: { ...input, doneBy: undefined, label }, doneBy }).returning();

    const lines: (typeof invCountLines.$inferInsert)[] = [];
    for (const i of items) {
      const own = batches.filter((b) => b.itemId === i.id);
      // Batch-tracked items are counted batch by batch; with no batch in stock, the item is one line (expected 0).
      if (i.track && own.length) for (const b of own) lines.push({ countId: count.id, itemId: i.id, batchId: b.id, systemQty: b.qtyOnHand });
      else lines.push({ countId: count.id, itemId: i.id, batchId: null, systemQty: i.qty });
    }
    await tx.insert(invCountLines).values(lines);
    return { id: count.id, countNo, lines: lines.length };
  });
}

/** Saves one counted quantity (or clears it with null). Refused once the count is complete. */
export async function saveCountLine(db: DB | Tx, lineId: number, counted: string | null) {
  let value: string | null = null;
  if (counted != null && counted.trim() !== "") {
    value = parseQty(counted);
    if (value == null || D(value).lt(0)) throw new UserFacingError("Please enter a number of 0 or more, e.g. 12 or 2.5.");
  }
  return db.transaction(async (tx) => {
    const [line] = await tx
      .select({ id: invCountLines.id, status: invCounts.status })
      .from(invCountLines)
      .innerJoin(invCounts, eq(invCounts.id, invCountLines.countId))
      .where(eq(invCountLines.id, lineId))
      .for("update", { of: invCounts });
    if (!line) throw new UserFacingError("That line could not be found. Please refresh the page.");
    if (line.status !== "IN_PROGRESS") throw new UserFacingError("This count is complete and can't be changed.");
    await tx
      .update(invCountLines)
      .set({ countedQty: value, countedAt: value == null ? null : new Date() })
      .where(eq(invCountLines.id, lineId));
    return { counted: value };
  });
}

/** Throws away an open count (nothing in stock changes). */
export async function discardCount(db: DB | Tx, countId: string) {
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(invCounts).where(eq(invCounts.id, countId)).for("update");
    if (!c) throw new UserFacingError("That count could not be found.");
    if (c.status !== "IN_PROGRESS") throw new UserFacingError("A completed count can't be discarded. Reverse its stock adjustment instead.");
    await tx.delete(invCounts).where(eq(invCounts.id, countId));
    return { countNo: c.countNo };
  });
}
