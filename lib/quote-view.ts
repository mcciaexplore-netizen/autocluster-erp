/**
 * One shape for "a quotation as printed". The live preview in the builder,
 * the quotation page and the PDF are all drawn from this, so they always match.
 */
import type { CustomerSnapshot, QuotationItem, Settings } from "@/db/schema";
import { amountInWords, CATEGORY_LABELS, formatQty, lineAmount, quantityInWords, toPaise, UNIT_SHORT, type Totals } from "./pricing";
import type { PricedLine } from "./quote-calc";

export interface QuoteViewLine {
  srNo: number;
  deptCode: string | null;
  description: string;
  notes: string | null;
  /** e.g. "50 cc x 4 parts = 200 cc" */
  quantityText: string;
  /** e.g. "200" */
  quantity: string;
  /** e.g. "cc" */
  unit: string;
  /** Rate before member discount (paise). */
  listRatePaise: number;
  /** quantity x list rate (paise). */
  grossPaise: number;
  discountPct: number;
  isCustomRate: boolean;
}

export interface QuoteView {
  org: { name: string; address: string; gstin: string; phone: string; email: string };
  quoteNo: string;
  quoteDate: string;
  validUntil: string;
  customer: CustomerSnapshot;
  categoryLabel: string;
  priceTypeLabel: string;
  subject: string;
  notes: string | null;
  terms: string;
  lines: QuoteViewLine[];
  totals: {
    subtotalPaise: number;
    discountPaise: number;
    discountPct: number;
    taxablePaise: number;
    intraState: boolean;
    gstPct: number;
    cgstPaise: number;
    sgstPaise: number;
    igstPaise: number;
    roundOffPaise: number;
    grandTotalPaise: number;
    amountInWords: string;
  };
}

function orgOf(s: Settings): QuoteView["org"] {
  return { name: s.orgName, address: s.orgAddress, gstin: s.orgGstin, phone: s.orgPhone, email: s.orgEmail };
}

function unitFor(unitType: QuotationItem["unitType"], unitLabel: string): string {
  return unitType ? UNIT_SHORT[unitType] : unitLabel.replace(/^per\s+/i, "");
}

/** From a saved quotation. */
export function viewFromSaved(
  q: {
    quoteNo: string;
    quoteDate: string;
    validUntil: string;
    customerSnapshot: CustomerSnapshot;
    priceType: string;
    memberDiscountPct: string;
    gstPct: string;
    subject: string;
    notes: string | null;
    terms: string;
    subtotal: string;
    discountTotal: string;
    taxableValue: string;
    cgst: string;
    sgst: string;
    igst: string;
    roundOff: string;
    grandTotal: string;
    items: QuotationItem[];
  },
  settings: Settings,
): QuoteView {
  const n = (v: string | null) => (v == null ? null : Number(v));
  return {
    org: orgOf(settings),
    quoteNo: q.quoteNo,
    quoteDate: q.quoteDate,
    validUntil: q.validUntil,
    customer: q.customerSnapshot,
    categoryLabel: CATEGORY_LABELS[q.customerSnapshot.category],
    priceTypeLabel: q.priceType,
    subject: q.subject,
    notes: q.notes,
    terms: q.terms,
    lines: q.items.map((it, i) => ({
      srNo: i + 1,
      deptCode: it.deptCode,
      description: it.description,
      notes: it.notes,
      quantityText: quantityInWords(
        it.isCustomItem ? null : it.unitType,
        {
          ccPerPart: n(it.ccPerPart),
          parts: it.parts,
          hours: n(it.hours),
          samples: it.samples,
          quantity: Number(it.billableQty),
        },
        unitFor(null, it.unitLabel),
      ),
      quantity: formatQty(it.billableQty),
      unit: unitFor(it.isCustomItem ? null : it.unitType, it.unitLabel),
      listRatePaise: toPaise(it.listRate),
      grossPaise: lineAmount(Number(it.billableQty), toPaise(it.listRate)),
      discountPct: Number(it.discountPct),
      isCustomRate: it.isCustomRate,
    })),
    totals: {
      subtotalPaise: toPaise(q.subtotal),
      discountPaise: toPaise(q.discountTotal),
      discountPct: Number(q.memberDiscountPct),
      taxablePaise: toPaise(q.taxableValue),
      intraState: Number(q.igst) === 0,
      gstPct: Number(q.gstPct),
      cgstPaise: toPaise(q.cgst),
      sgstPaise: toPaise(q.sgst),
      igstPaise: toPaise(q.igst),
      roundOffPaise: toPaise(q.roundOff),
      grandTotalPaise: toPaise(q.grandTotal),
      amountInWords: amountInWords(toPaise(q.grandTotal)),
    },
  };
}

/** From the builder's live state (nothing saved yet). */
export function viewFromLive(args: {
  settings: Settings;
  quoteNo: string;
  quoteDate: string;
  validUntil: string;
  customer: CustomerSnapshot;
  priceTypeLabel: string;
  discountPct: number;
  subject: string;
  notes: string | null;
  terms: string;
  lines: PricedLine[];
  totals: Totals;
}): QuoteView {
  return {
    org: orgOf(args.settings),
    quoteNo: args.quoteNo,
    quoteDate: args.quoteDate,
    validUntil: args.validUntil,
    customer: args.customer,
    categoryLabel: CATEGORY_LABELS[args.customer.category],
    priceTypeLabel: args.priceTypeLabel,
    subject: args.subject,
    notes: args.notes,
    terms: args.terms,
    lines: args.lines.map((l, i) => ({
      srNo: i + 1,
      deptCode: l.draft.deptCode,
      description: l.draft.description,
      notes: l.draft.notes?.trim() || null,
      quantityText: l.quantityText,
      quantity: formatQty(l.billableQty),
      unit: unitFor(l.isCustomItem ? null : l.draft.unitType, l.draft.unitLabel),
      listRatePaise: l.listRatePaise,
      grossPaise: l.grossPaise,
      discountPct: l.discountPct,
      isCustomRate: l.isCustomRate,
    })),
    totals: { ...args.totals, discountPct: args.discountPct },
  };
}
