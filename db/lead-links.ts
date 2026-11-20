/**
 * How enquiries connect to the other modules:
 * - Convert to customer: the enquiry is linked to the new customer.
 * - Quotation created from an enquiry: lead_id is saved and the automatic move from
 *   Settings > CRM is applied (only while the enquiry is open).
 * - That quotation Accepted: the enquiry is marked as Won (once; never if already Won).
 * Kept free of Next.js imports.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import type { DB, Tx } from "./client";
import { logLeadEvent, moveLead } from "./lead-writer";
import { createQuotation, UserFacingError, type QuotationInput } from "./quote-writer";
import { crmStages, customers, leads, quotations, settings } from "./schema";

async function lockLiveLead(tx: Tx, leadId: string) {
  const [lead] = await tx.select().from(leads).where(and(eq(leads.id, leadId), isNull(leads.deletedAt))).for("update");
  if (!lead) throw new UserFacingError("This enquiry could not be found. It may have been deleted.");
  return lead;
}

/** After "Convert to customer": links the enquiry to the customer that was just saved. */
export async function linkLeadToCustomer(db: DB | Tx, leadId: string, customerId: string) {
  return db.transaction(async (tx) => {
    const lead = await lockLiveLead(tx, leadId);
    const [c] = await tx.select({ id: customers.id, companyName: customers.companyName, deletedAt: customers.deletedAt }).from(customers).where(eq(customers.id, customerId));
    if (!c || c.deletedAt) throw new UserFacingError("The customer could not be found.");
    if (lead.customerId === c.id) return { linked: false, companyName: c.companyName };
    await tx.update(leads).set({ customerId: c.id }).where(eq(leads.id, leadId));
    await logLeadEvent(tx, leadId, "CONVERTED", `Converted to customer: ${c.companyName}`, { customerId: c.id });
    return { linked: true, companyName: c.companyName };
  });
}

/**
 * Creates a quotation made from an enquiry: saves lead_id, writes the history, and applies
 * the automatic move ("When a quotation is created from an enquiry, move it to:").
 */
export async function createQuotationFromLead(db: DB, input: QuotationInput, leadId: string) {
  return db.transaction(async (tx) => {
    const lead = await lockLiveLead(tx, leadId);
    if (lead.customerId && lead.customerId !== input.customerId)
      throw new UserFacingError("This enquiry is linked to a different customer. Please create the quotation from the enquiry again.");
    const q = await createQuotation(tx, { ...input, leadId });
    if (!lead.customerId) await tx.update(leads).set({ customerId: input.customerId }).where(eq(leads.id, leadId));
    await logLeadEvent(tx, leadId, "QUOTATION", `Quotation ${q.quoteNo} created`, { quotationId: q.id });

    let movedTo: string | null = null;
    const [set] = await tx.select({ to: settings.quoteCreatedMoveToStageId }).from(settings).where(eq(settings.id, 1));
    const stages = await tx.select().from(crmStages).orderBy(asc(crmStages.sortOrder));
    const current = stages.find((s) => s.id === lead.stageId);
    const target = set?.to ? stages.find((s) => s.id === set.to && s.type === "OPEN") : undefined;
    // Only moves an open enquiry; a Won or Lost one is never reopened by this.
    if (target && current?.type === "OPEN" && current.id !== target.id) {
      await moveLead(tx, leadId, target.id, { message: `Moved from ${current.name} to ${target.name}: quotation ${q.quoteNo} created` });
      movedTo = target.name;
    }
    return { ...q, movedTo };
  });
}

/**
 * Called when a quotation becomes Accepted (inside that transaction). If it came from an
 * enquiry that isn't already Won, the enquiry moves to Won with a history entry.
 */
export async function markLeadWonForQuotation(tx: Tx, quotationId: string): Promise<{ leadNo: string } | null> {
  const [q] = await tx.select({ leadId: quotations.leadId, quoteNo: quotations.quoteNo }).from(quotations).where(eq(quotations.id, quotationId));
  if (!q?.leadId) return null;
  const [lead] = await tx.select().from(leads).where(eq(leads.id, q.leadId)).for("update");
  if (!lead || lead.deletedAt) return null;
  const stages = await tx.select().from(crmStages);
  const won = stages.find((s) => s.type === "WON");
  const current = stages.find((s) => s.id === lead.stageId);
  if (!won || current?.type === "WON") return null;
  await moveLead(tx, lead.id, won.id, { message: `Marked as won: quotation ${q.quoteNo} was accepted` });
  return { leadNo: lead.leadNo };
}

/** Quotation Rejected: no automatic move, only a history line (the enquiry then suggests "Mark as lost"). */
export async function noteQuotationRejected(tx: Tx, quotationId: string) {
  const [q] = await tx.select({ leadId: quotations.leadId, quoteNo: quotations.quoteNo }).from(quotations).where(eq(quotations.id, quotationId));
  if (!q?.leadId) return;
  const [lead] = await tx.select({ id: leads.id, deletedAt: leads.deletedAt }).from(leads).where(eq(leads.id, q.leadId));
  if (!lead || lead.deletedAt) return;
  await logLeadEvent(tx, lead.id, "QUOTATION", `Quotation ${q.quoteNo} was rejected`, { quotationId });
}
