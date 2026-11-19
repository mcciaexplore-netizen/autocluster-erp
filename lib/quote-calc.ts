/**
 * Turns the lines a user builds in the quotation builder into priced lines
 * and totals. Pure functions only, so the same code runs live in the browser
 * and again on the server when the quotation is saved.
 */
import {
  billableQuantity,
  calculateLine,
  calculateTotals,
  customerRate,
  quantityInWords,
  type LineResult,
  type PriceType,
  type PricingSettings,
  type RateCardService,
  type Totals,
  type UnitType,
} from "./pricing";

export interface DraftLine {
  /** Stable key for React lists. */
  key: string;
  /** null for a custom item that is not on the rate card. */
  serviceId: number | null;
  deptCode: string | null;
  description: string;
  unitType: UnitType | null;
  /** "per cc", or free text for custom items, e.g. "per piece". */
  unitLabel: string;
  ccPerPart?: number | null;
  parts?: number | null;
  hours?: number | null;
  samples?: number | null;
  /** Custom items only. */
  quantity?: number | null;
  /** Rate typed by staff in paise. Set for custom items and "Change rate". */
  customRatePaise: number | null;
  notes?: string | null;
  /**
   * Rates saved on an existing quotation. When present they are used instead
   * of today's rate card, so editing an old quotation never re-prices it.
   */
  locked?: { listRatePaise: number; discountPct: number } | null;
}

export interface PricedLine extends LineResult {
  draft: DraftLine;
  isCustomRate: boolean;
  isCustomItem: boolean;
  quantityText: string;
}

export interface ServiceForPricing extends RateCardService {
  id: number;
}

export function priceLine(
  draft: DraftLine,
  service: ServiceForPricing | null | undefined,
  priceType: PriceType,
): PricedLine {
  const isCustomItem = draft.serviceId == null;
  const qty = billableQuantity(draft.unitType, draft);
  let listRatePaise: number;
  let discountPct: number;
  let isCustomRate = false;

  if (isCustomItem || (!service && !draft.locked)) {
    listRatePaise = draft.customRatePaise ?? 0;
    discountPct = 0;
  } else if (draft.customRatePaise != null) {
    // Staff changed the rate: use it as-is, no member discount on top.
    listRatePaise = draft.customRatePaise;
    discountPct = 0;
    isCustomRate = true;
  } else if (draft.locked) {
    listRatePaise = draft.locked.listRatePaise;
    discountPct = draft.locked.discountPct;
  } else {
    const r = customerRate(service!, priceType);
    listRatePaise = r.listRatePaise;
    discountPct = r.discountPct;
  }

  const result = calculateLine({ billableQty: qty, listRatePaise, discountPct });
  return {
    ...result,
    draft,
    isCustomRate,
    isCustomItem,
    quantityText: quantityInWords(draft.unitType, draft, isCustomItem ? draft.unitLabel.replace(/^per\s+/i, "") : null),
  };
}

export function priceQuotation(
  drafts: DraftLine[],
  servicesById: Map<number, ServiceForPricing>,
  priceType: PriceType,
  customerStateCode: string | null,
  settings: PricingSettings,
): { lines: PricedLine[]; totals: Totals } {
  const lines = drafts.map((d) => priceLine(d, d.serviceId != null ? servicesById.get(d.serviceId) : null, priceType));
  const totals = calculateTotals(lines, { customerStateCode }, settings);
  return { lines, totals };
}

/** Problems that stop a line from being added or saved, in plain words. */
export function lineProblems(d: DraftLine): string[] {
  const p: string[] = [];
  const pos = (v: number | null | undefined) => typeof v === "number" && v > 0;
  if (!d.description.trim()) p.push("Please describe the service.");
  switch (d.unitType) {
    case "PER_CC":
      if (!pos(d.ccPerPart)) p.push("Enter the volume per part in cc.");
      if (!pos(d.parts)) p.push("Enter the number of parts.");
      break;
    case "PER_HOUR":
      if (!pos(d.hours)) p.push("Enter the machine hours.");
      break;
    case "PER_SAMPLE":
      if (!pos(d.samples)) p.push("Enter the number of samples.");
      break;
    case "PER_HOUR_3_SAMPLES":
      if (!pos(d.hours)) p.push("Enter the test hours.");
      if (!pos(d.samples)) p.push("Enter the number of samples.");
      break;
    default:
      if (!pos(d.quantity)) p.push("Enter a quantity.");
  }
  if (d.serviceId == null && !(d.customRatePaise != null && d.customRatePaise > 0)) p.push("Enter a rate.");
  if (d.customRatePaise != null && d.customRatePaise < 0) p.push("The rate cannot be negative.");
  return p;
}
