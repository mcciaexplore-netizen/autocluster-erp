/**
 * Tax invoices. One invoice can cover several tickets of the same customer (all in Billing).
 * Saving moves them to Payment follow-up together, in one transaction.
 * Free of Next.js imports so scripts and tests can use it.
 */
import { eq, inArray, sql } from "drizzle-orm";
import { formatDate } from "../lib/format";
import { formatINR, paiseToRupeeString } from "../lib/pricing";
import { addDays } from "../lib/tickets";
import type { DB, Tx } from "./client";
import { UserFacingError } from "./quote-writer";
import { customers, files, invoices, tickets } from "./schema";
import { addEvents } from "./ticket-writer";

type Conn = DB | Tx;

export interface AddInvoiceInput {
  ticketIds: string[];
  invoiceNumber: string;
  invoiceDate: string;
  amountPaise: number;
  creditDays: number;
  dueDate: string;
  fileId: string;
}

const normaliseNo = (s: string) => s.trim().replace(/\s+/g, " ");

/** Who already uses this invoice number (numbers are unique across all customers). */
export async function findInvoice(conn: Conn, invoiceNumber: string) {
  const no = normaliseNo(invoiceNumber);
  if (!no) return null;
  const [row] = await conn
    .select({ id: invoices.id, number: invoices.invoiceNumber, date: invoices.invoiceDate, company: customers.companyName })
    .from(invoices)
    .innerJoin(customers, eq(customers.id, invoices.customerId))
    .where(sql`lower(${invoices.invoiceNumber}) = lower(${no})`);
  return row ?? null;
}

function usedMessage(u: { number: string; date: string; company: string }) {
  return `Invoice number ${u.number} is already used (${u.company}, ${formatDate(u.date)}). Please check the number.`;
}

export async function addInvoice(db: DB, input: AddInvoiceInput, today: string) {
  const ids = [...new Set(input.ticketIds)];
  if (!ids.length) throw new UserFacingError("Please tick at least one service.");
  const number = normaliseNo(input.invoiceNumber);
  if (!number) throw new UserFacingError("Please enter the invoice number.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.invoiceDate)) throw new UserFacingError("Please enter the invoice date.");
  if (input.invoiceDate > today) throw new UserFacingError("The invoice date can't be in the future.");
  if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0) throw new UserFacingError("Please enter the invoice amount.");
  if (!Number.isInteger(input.creditDays) || input.creditDays < 0 || input.creditDays > 365) throw new UserFacingError("Credit period should be between 0 and 365 days.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) throw new UserFacingError("Please enter the due date.");
  if (input.dueDate < input.invoiceDate) throw new UserFacingError("The due date can't be before the invoice date.");

  return db.transaction(async (tx) => {
    const locked = await tx.execute<{ id: string; ticket_no: string; stage: string; customer_id: string }>(
      sql`select id, ticket_no, stage, customer_id from tickets where id = any(${sql.param(ids)}::uuid[]) order by seq for update`,
    );
    const rows = locked.rows;
    if (rows.length !== ids.length) throw new UserFacingError("Some of these tickets could not be found. Please refresh the page.");
    const customerId = rows[0].customer_id;
    if (rows.some((r) => r.customer_id !== customerId)) throw new UserFacingError("One invoice can only cover services of the same customer.");
    const notReady = rows.filter((r) => r.stage !== "BILLING");
    if (notReady.length)
      throw new UserFacingError(`${notReady.map((r) => r.ticket_no).join(", ")} ${notReady.length === 1 ? "is" : "are"} not in Billing any more. Please refresh the page.`);

    const [f] = await tx.select({ kind: files.kind }).from(files).where(eq(files.id, input.fileId));
    if (!f || f.kind !== "INVOICE") throw new UserFacingError("Please upload the tax invoice file again.");

    const used = await findInvoice(tx, number);
    if (used) throw new UserFacingError(usedMessage(used));
    const [inv] = await tx
      .insert(invoices)
      .values({
        customerId,
        invoiceNumber: number,
        invoiceDate: input.invoiceDate,
        amount: paiseToRupeeString(input.amountPaise),
        creditDays: input.creditDays,
        dueDate: input.dueDate,
        fileId: input.fileId,
      })
      .onConflictDoNothing()
      .returning();
    if (!inv) {
      const again = await findInvoice(tx, number);
      throw new UserFacingError(again ? usedMessage(again) : "We couldn't save that invoice. Please try again.");
    }

    await tx.update(tickets).set({ stage: "PAYMENT", invoiceId: inv.id, stageChangedAt: new Date(), updatedAt: new Date() }).where(inArray(tickets.id, ids));
    const others = rows.length > 1 ? ` (covers ${rows.map((r) => r.ticket_no).join(", ")})` : "";
    await addEvents(
      tx,
      ids,
      "INVOICE_UPLOADED",
      `Tax invoice ${number} dated ${formatDate(input.invoiceDate)}, ${formatINR(input.amountPaise)}, due ${formatDate(input.dueDate)}${others}. Moved to Payment follow-up.`,
      { invoiceId: inv.id },
    );
    return { invoiceId: inv.id, invoiceNumber: number, dueDate: input.dueDate, moved: rows.map((r) => r.ticket_no) };
  });
}

/** Default due date: invoice date + credit days. */
export function dueDateFor(invoiceDate: string, creditDays: number) {
  return addDays(invoiceDate, creditDays);
}
