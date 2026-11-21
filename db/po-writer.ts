/**
 * Purchase orders and uploaded files.
 * Free of Next.js imports so scripts and tests can use it.
 *
 * Rules:
 * - One PO can cover several tickets of the same customer (all must be in Waiting for PO).
 * - PO numbers are unique per customer. Re-using one means linking the existing PO.
 * - Saving moves every selected ticket to Billing in one transaction, with a PO_ADDED event each.
 */
import { firmUpBookingsForTickets } from "./job-writer";
import { and, eq, inArray, sql } from "drizzle-orm";
import { formatDate } from "../lib/format";
import { formatINR, paiseToRupeeString, toPaise } from "../lib/pricing";
import type { DB, Tx } from "./client";
import { UserFacingError } from "./quote-writer";
import { files, purchaseOrders, tickets } from "./schema";
import { addEvents } from "./ticket-writer";

type Conn = DB | Tx;

export interface ExistingPo {
  id: string;
  number: string;
  date: string;
  amountPaise: number;
  fileId: string | null;
  ticketNos: string[];
}

export interface AddPoInput {
  ticketIds: string[];
  /** Link to a PO that is already saved for this customer, instead of creating a new one. */
  existingPoId?: string | null;
  poNumber?: string;
  poDate?: string;
  poAmountPaise?: number;
  fileId?: string | null;
  notes?: string | null;
}

export class DuplicatePoError extends UserFacingError {
  constructor(public existing: ExistingPo) {
    super(`This customer already has PO ${existing.number}. You can link these services to it instead.`);
  }
}

const normalisePoNo = (s: string) => s.trim().replace(/\s+/g, " ");

export async function findPo(conn: Conn, customerId: string, poNumber: string): Promise<ExistingPo | null> {
  const no = normalisePoNo(poNumber);
  if (!no) return null;
  const [po] = await conn
    .select()
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.customerId, customerId), sql`lower(${purchaseOrders.poNumber}) = lower(${no})`));
  if (!po) return null;
  const ts = await conn.select({ no: tickets.ticketNo }).from(tickets).where(eq(tickets.poId, po.id)).orderBy(tickets.seq);
  return { id: po.id, number: po.poNumber, date: po.poDate, amountPaise: toPaise(po.poAmount), fileId: po.fileId, ticketNos: ts.map((t) => t.no) };
}

/** Saves the PO (or links an existing one) and moves the tickets to Billing. */
export async function addPurchaseOrder(db: DB, input: AddPoInput, today: string) {
  const ids = [...new Set(input.ticketIds)];
  if (!ids.length) throw new UserFacingError("Please tick at least one service.");

  return db.transaction(async (tx) => {
    // Lock the tickets so two people can't add a PO to the same ticket at once.
    const locked = await tx.execute<{ id: string; ticket_no: string; stage: string; customer_id: string }>(
      sql`select id, ticket_no, stage, customer_id from tickets where id = any(${sql.param(ids)}::uuid[]) order by seq for update`,
    );
    const rows = locked.rows;
    if (rows.length !== ids.length) throw new UserFacingError("Some of these tickets could not be found. Please refresh the page.");
    const customerId = rows[0].customer_id;
    if (rows.some((r) => r.customer_id !== customerId)) throw new UserFacingError("One PO can only cover services of the same customer.");
    const moved = rows.filter((r) => r.stage !== "WAITING_PO");
    if (moved.length)
      throw new UserFacingError(`${moved.map((r) => r.ticket_no).join(", ")} ${moved.length === 1 ? "is" : "are"} no longer waiting for a PO. Please refresh the page.`);

    let po: { id: string; number: string; date: string; amountPaise: number };
    let linked = false;
    if (input.existingPoId) {
      const [p] = await tx
        .select()
        .from(purchaseOrders)
        .where(and(eq(purchaseOrders.id, input.existingPoId), eq(purchaseOrders.customerId, customerId)));
      if (!p) throw new UserFacingError("That PO could not be found for this customer.");
      po = { id: p.id, number: p.poNumber, date: p.poDate, amountPaise: toPaise(p.poAmount) };
      linked = true;
    } else {
      const poNumber = normalisePoNo(input.poNumber ?? "");
      if (!poNumber) throw new UserFacingError("Please enter the PO number.");
      if (!input.poDate || !/^\d{4}-\d{2}-\d{2}$/.test(input.poDate)) throw new UserFacingError("Please enter the PO date.");
      if (input.poDate > today) throw new UserFacingError("The PO date can't be in the future.");
      const amount = input.poAmountPaise ?? 0;
      if (!Number.isInteger(amount) || amount <= 0) throw new UserFacingError("Please enter the PO amount.");
      if (input.fileId) {
        const [f] = await tx.select({ kind: files.kind }).from(files).where(eq(files.id, input.fileId));
        if (!f || f.kind !== "PO") throw new UserFacingError("The PO copy could not be found. Please upload it again.");
      }
      const dup = await findPo(tx, customerId, poNumber);
      if (dup) throw new DuplicatePoError(dup);
      const [p] = await tx
        .insert(purchaseOrders)
        .values({
          customerId,
          poNumber,
          poDate: input.poDate,
          poAmount: paiseToRupeeString(amount),
          fileId: input.fileId ?? null,
          notes: input.notes?.trim() || null,
        })
        .onConflictDoNothing()
        .returning();
      if (!p) {
        // Someone saved the same PO number a moment ago.
        const again = await findPo(tx, customerId, poNumber);
        if (again) throw new DuplicatePoError(again);
        throw new UserFacingError("We couldn't save that PO. Please try again.");
      }
      po = { id: p.id, number: p.poNumber, date: p.poDate, amountPaise: amount };
    }

    await tx.update(tickets).set({ stage: "BILLING", poId: po.id, stageChangedAt: new Date(), updatedAt: new Date() }).where(inArray(tickets.id, ids));
    const others = rows.length > 1 ? ` (covers ${rows.map((r) => r.ticket_no).join(", ")})` : "";
    await addEvents(
      tx,
      ids,
      "PO_ADDED",
      `${linked ? "Linked to" : "PO added:"} PO ${po.number} dated ${formatDate(po.date)}, ${formatINR(po.amountPaise)}${others}. Moved to Billing.`,
      { poId: po.id, linked },
    );
    // Planning: tentative bookings for these tickets become firm.
    await firmUpBookingsForTickets(tx, ids, po.number);
    return { poId: po.id, poNumber: po.number, moved: rows.map((r) => r.ticket_no) };
  });
}

export async function registerFile(conn: Conn, f: { kind: "PO" | "INVOICE" | "BILL" | "JOB"; blobPath: string; fileName: string; size: number; mime: string }) {
  const [row] = await conn.insert(files).values(f).returning({ id: files.id });
  return row.id;
}
