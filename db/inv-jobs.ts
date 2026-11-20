/**
 * Material cost of a job (brief 9.5): the saved values of all stock used for the ticket,
 * minus any reversals. Kept free of Next.js imports so tests can use it.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import type { DB, Tx } from "./client";
import { invDocuments } from "./schema";

export async function ticketMaterialCost(db: DB | Tx, ticketId: string) {
  const lines = await db.execute<{ item_id: string; name: string; unit: string; qty: string; value: string }>(sql`
    select m.item_id, i.name, u.name as unit, sum(m.qty_out) - sum(m.qty_in) as qty, sum(case when m.qty_out > 0 then m.value else -m.value end) as value
    from inv_movements m join inv_documents d on d.id = m.document_id join inv_items i on i.id = m.item_id join inv_units u on u.id = i.unit_id
    where d.ticket_id = ${ticketId} and d.type = 'OUT'
    group by m.item_id, i.name, u.name
    having sum(m.qty_out) - sum(m.qty_in) <> 0
    order by i.name`);
  const docs = await db
    .select({ id: invDocuments.id, docNo: invDocuments.docNo, docDate: invDocuments.docDate, reverses: invDocuments.reversesDocId, reversedBy: invDocuments.reversedByDocId })
    .from(invDocuments)
    .where(and(eq(invDocuments.ticketId, ticketId), eq(invDocuments.type, "OUT")))
    .orderBy(asc(invDocuments.createdAt));
  const items = lines.rows.map((r) => ({ itemId: r.item_id, name: r.name, unit: r.unit, qty: r.qty, valuePaise: Number(r.value) }));
  return { items, docs, costPaise: items.reduce((a, l) => a + l.valuePaise, 0) };
}
