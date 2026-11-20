/**
 * Writing quotations. Kept free of Next.js imports so the seed script can use it.
 *
 * Rules enforced here:
 * - Amounts are always recalculated on the server from the rate card.
 * - The customer and every rate are copied into the quotation (snapshot),
 *   so later edits to a customer or the rate card never change old quotations.
 * - Quotation numbers come from a counter row that is locked inside the
 *   transaction, so two people can never get the same number, and numbers
 *   are never reused (even if a quotation is deleted).
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { financialYear, formatQuoteNo, paiseToRupeeString, priceTypeFor } from "@/lib/pricing";
import { priceQuotation, type DraftLine, type ServiceForPricing } from "@/lib/quote-calc";
import { toPricingSettings } from "@/lib/settings-shared";
import type { DB, Tx } from "./client";
import {
  customers,
  quotationItems,
  quotations,
  quoteCounters,
  services,
  settings as settingsTable,
  tickets,
  type Customer,
  type CustomerSnapshot,
} from "./schema";

export interface QuotationInput {
  customerId: string;
  quoteDate: string; // YYYY-MM-DD
  validUntil: string; // YYYY-MM-DD
  subject: string;
  notes: string | null;
  terms: string;
  status: "DRAFT" | "SENT" | "ACCEPTED" | "REJECTED";
  lines: DraftLine[];
  /** The CRM enquiry it was made from (only set when creating). */
  leadId?: string | null;
}

export function snapshotOf(c: Customer): CustomerSnapshot {
  return {
    id: c.id,
    companyName: c.companyName,
    category: c.category,
    addressLine1: c.addressLine1,
    addressLine2: c.addressLine2,
    city: c.city,
    state: c.state,
    stateCode: c.stateCode,
    pincode: c.pincode,
    gstRegistered: c.gstRegistered,
    gstin: c.gstin,
    pan: c.pan,
    pocName: c.pocName,
    pocDesignation: c.pocDesignation,
    pocPhone: c.pocPhone,
    pocEmail: c.pocEmail,
    isMcciaMember: c.isMcciaMember,
    mcciaMembershipId: c.mcciaMembershipId,
  };
}

/** Atomically takes the next number for a financial year. */
export async function nextQuoteSeq(tx: Tx | DB, fy: string): Promise<number> {
  const [row] = await tx
    .insert(quoteCounters)
    .values({ fy, lastSeq: 1 })
    .onConflictDoUpdate({ target: quoteCounters.fy, set: { lastSeq: sql`${quoteCounters.lastSeq} + 1` } })
    .returning({ seq: quoteCounters.lastSeq });
  return row.seq;
}

async function buildRows(tx: Tx, input: QuotationInput) {
  const [settingsRow] = await tx.select().from(settingsTable).where(eq(settingsTable.id, 1));
  if (!settingsRow) throw new Error("Settings are missing. Run the seed script.");
  const pricing = toPricingSettings(settingsRow);

  const [customer] = await tx.select().from(customers).where(eq(customers.id, input.customerId));
  if (!customer || customer.deletedAt) throw new UserFacingError("This customer could not be found.");

  const serviceIds = input.lines.map((l) => l.serviceId).filter((id): id is number => id != null);
  const svcRows = serviceIds.length
    ? await tx.select().from(services).where(inArray(services.id, serviceIds))
    : [];
  const byId = new Map<number, ServiceForPricing & (typeof svcRows)[number]>(svcRows.map((s) => [s.id, s]));

  const priceType = priceTypeFor(customer, pricing);
  const { lines, totals } = priceQuotation(input.lines, byId, priceType, customer.stateCode, pricing);

  const header = {
    customerId: customer.id,
    customerSnapshot: snapshotOf(customer),
    priceType: priceType.label,
    memberDiscountPct: String(priceType.discountPct),
    gstPct: String(pricing.gstPct),
    subject: input.subject,
    quoteDate: input.quoteDate,
    validUntil: input.validUntil,
    subtotal: paiseToRupeeString(totals.subtotalPaise),
    discountTotal: paiseToRupeeString(totals.discountPaise),
    taxableValue: paiseToRupeeString(totals.taxablePaise),
    cgst: paiseToRupeeString(totals.cgstPaise),
    sgst: paiseToRupeeString(totals.sgstPaise),
    igst: paiseToRupeeString(totals.igstPaise),
    roundOff: paiseToRupeeString(totals.roundOffPaise),
    grandTotal: paiseToRupeeString(totals.grandTotalPaise),
    status: input.status,
    notes: input.notes,
    terms: input.terms,
    ...(input.leadId !== undefined ? { leadId: input.leadId } : {}),
  };

  const items = lines.map((l, i) => {
    const d = l.draft;
    const svc = d.serviceId != null ? byId.get(d.serviceId) : undefined;
    return {
      sortOrder: i,
      serviceId: svc ? svc.id : null,
      deptCode: svc ? svc.deptCode : d.deptCode,
      description: d.description,
      unitType: svc ? svc.unitType : null,
      unitLabel: svc ? svc.unitLabel : d.unitLabel,
      hours: d.hours != null ? String(d.hours) : null,
      samples: d.samples ?? null,
      ccPerPart: d.ccPerPart != null ? String(d.ccPerPart) : null,
      parts: d.parts ?? null,
      billableQty: String(l.billableQty),
      listRate: paiseToRupeeString(l.listRatePaise),
      discountPct: String(l.discountPct),
      finalRate: paiseToRupeeString(l.finalRatePaise),
      isCustomRate: l.isCustomRate,
      isCustomItem: l.isCustomItem,
      amount: paiseToRupeeString(l.amountPaise),
      notes: d.notes?.trim() || null,
    };
  });

  return { header, items, prefix: settingsRow.quotePrefix };
}

export class UserFacingError extends Error {}

export async function createQuotation(db: DB | Tx, input: QuotationInput) {
  return db.transaction(async (tx) => {
    const { header, items, prefix } = await buildRows(tx, input);
    const fy = financialYear(new Date(`${input.quoteDate}T00:00:00`));
    const seq = await nextQuoteSeq(tx, fy);
    const quoteNo = formatQuoteNo(prefix, fy, seq);
    const [q] = await tx
      .insert(quotations)
      .values({ ...header, quoteNo, fy, seq })
      .returning({ id: quotations.id, quoteNo: quotations.quoteNo });
    if (items.length) await tx.insert(quotationItems).values(items.map((it) => ({ ...it, quotationId: q.id })));
    return q;
  });
}

export const LOCKED_MESSAGE =
  "This quotation is locked because its tickets are open on the Orders & Billing board. To make changes, use “Duplicate as revised quotation”.";

/** Updates a quotation's content. The number stays the same. Refused once tickets exist. */
export async function updateQuotation(db: DB | Tx, id: string, input: QuotationInput) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from quotations where id = ${id} for update`);
    const t = await tx.select({ id: tickets.id }).from(tickets).where(eq(tickets.quotationId, id)).limit(1);
    if (t.length) throw new UserFacingError(LOCKED_MESSAGE);
    const { header, items } = await buildRows(tx, input);
    const [q] = await tx
      .update(quotations)
      .set(header)
      .where(and(eq(quotations.id, id)))
      .returning({ id: quotations.id, quoteNo: quotations.quoteNo });
    if (!q) throw new UserFacingError("This quotation could not be found.");
    await tx.delete(quotationItems).where(eq(quotationItems.quotationId, id));
    if (items.length) await tx.insert(quotationItems).values(items.map((it) => ({ ...it, quotationId: id })));
    return q;
  });
}
