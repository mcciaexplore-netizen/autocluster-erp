/**
 * Reorder list: "Send to supplier" notes what was sent and marks each item "Ordered on <date>",
 * so nobody orders it twice. The marker clears when stock of the item is received from that
 * supplier (stock-writer.ts), or by hand. Kept free of Next.js imports.
 */
import { eq, sql } from "drizzle-orm";
import { D, parseQty, qtyText } from "@/lib/inventory/numbers";
import { todayInIndia } from "@/lib/tickets";
import type { DB, Tx } from "./client";
import { UserFacingError } from "./quote-writer";
import { invItems, invReorderSends, invSuppliers, invUnits, teamMembers } from "./schema";

export const SEND_METHODS = ["WHATSAPP", "EMAIL", "PDF", "EXCEL"] as const;
export type SendMethod = (typeof SEND_METHODS)[number];

export async function markOrdered(
  db: DB | Tx,
  input: { supplierId: string; method: SendMethod; doneBy?: string | null; lines: { itemId: string; qty: string }[] },
  opts: { today?: string } = {},
) {
  const today = opts.today ?? todayInIndia();
  if (!SEND_METHODS.includes(input.method)) throw new UserFacingError("Please choose how the list is sent.");
  if (!input.lines.length) throw new UserFacingError("Please tick at least one item.");
  return db.transaction(async (tx) => {
    const [sup] = await tx.select({ id: invSuppliers.id, name: invSuppliers.name }).from(invSuppliers).where(eq(invSuppliers.id, input.supplierId));
    if (!sup) throw new UserFacingError("That supplier could not be found.");
    let doneBy: string | null = null;
    if (input.doneBy) {
      const [m] = await tx.select({ id: teamMembers.id }).from(teamMembers).where(eq(teamMembers.id, input.doneBy));
      doneBy = m?.id ?? null;
    }
    const ids = [...new Set(input.lines.map((l) => l.itemId))];
    const items = await tx
      .select({ id: invItems.id, name: invItems.name, unit: invUnits.name })
      .from(invItems)
      .innerJoin(invUnits, eq(invUnits.id, invItems.unitId))
      .where(sql`${invItems.id} = any(${sql.param(ids)}::uuid[])`);
    if (items.length !== ids.length) throw new UserFacingError("One of the items could not be found. Please refresh the page.");
    const sent = input.lines.map((l) => {
      const it = items.find((i) => i.id === l.itemId)!;
      const q = parseQty(l.qty);
      if (q == null || D(q).lte(0)) throw new UserFacingError(`Please enter the quantity to order of ${it.name}.`);
      return { itemId: it.id, name: it.name, qty: qtyText(q), unit: it.unit };
    });
    await tx.insert(invReorderSends).values({ supplierId: sup.id, items: sent, method: input.method, doneBy });
    await tx
      .update(invItems)
      .set({ orderedOn: today, orderedSupplierId: sup.id })
      .where(sql`${invItems.id} = any(${sql.param(ids)}::uuid[])`);
    return { supplier: sup.name, items: sent.length, orderedOn: today };
  });
}

/** Clears the "Ordered on" marker by hand (e.g. the order was cancelled). */
export async function clearOrdered(db: DB | Tx, itemId: string) {
  const [r] = await db.update(invItems).set({ orderedOn: null, orderedSupplierId: null }).where(eq(invItems.id, itemId)).returning({ name: invItems.name });
  if (!r) throw new UserFacingError("That item could not be found.");
  return r;
}
