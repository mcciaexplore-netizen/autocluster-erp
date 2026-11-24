/**
 * Single source of truth for every price, discount and tax in the app.
 *
 * Money is handled as integer paise (1 rupee = 100 paise) so we never do
 * floating point arithmetic on money. Quantities can be fractional
 * (e.g. 2.5 hours, 12.5 cc), so quantity x rate is calculated with
 * decimal.js and then rounded to the nearest paisa (half up).
 */
import Decimal from "decimal.js";

export type Category = "OEM" | "TIER1" | "TIER2" | "MSME";
export type UnitType = "PER_CC" | "PER_HOUR" | "PER_SAMPLE" | "PER_HOUR_3_SAMPLES";
export type RateKind = "MSME" | "OEM";

export const CATEGORY_LABELS: Record<Category, string> = {
  OEM: "OEM",
  TIER1: "Tier 1",
  TIER2: "Tier 2",
  MSME: "MSME",
};

export const UNIT_LABELS: Record<UnitType, string> = {
  PER_CC: "per cc",
  PER_HOUR: "per hour",
  PER_SAMPLE: "per sample",
  PER_HOUR_3_SAMPLES: "per hour (up to 3 samples)",
};

/** Short unit used next to a quantity, e.g. "200 cc". */
export const UNIT_SHORT: Record<UnitType, string> = {
  PER_CC: "cc",
  PER_HOUR: "hours",
  PER_SAMPLE: "samples",
  PER_HOUR_3_SAMPLES: "hours",
};

export const SAMPLES_PER_RUN = 3;

export interface PricingSettings {
  /** e.g. 10 for 10% */
  memberDiscountPct: number;
  /** Apply the member discount to OEM / Tier 1 / Tier 2 members too. */
  applyDiscountToNonMsme: boolean;
  /** e.g. 18 for 18% */
  gstPct: number;
  /** Two digit GST state code of our organisation, e.g. "27". */
  homeStateCode: string;
}

export const DEFAULT_PRICING_SETTINGS: PricingSettings = {
  memberDiscountPct: 10,
  applyDiscountToNonMsme: true,
  gstPct: 18,
  homeStateCode: "27",
};

export interface PricingCustomer {
  category: Category;
  isMcciaMember: boolean;
}

export interface PriceType {
  rateKind: RateKind;
  /** Discount % applied to rate-card services. 0 when no discount. */
  discountPct: number;
  /** Plain-words explanation, e.g. "MSME rate, less 10% MCCIA member discount". */
  label: string;
  /** Short form for badges, e.g. "MSME rate + 10% MCCIA member discount". */
  badge: string;
}

// ---------------------------------------------------------------------------
// Money helpers
// ---------------------------------------------------------------------------

/** Rupees (number or numeric string) -> integer paise. */
export function toPaise(rupees: number | string | Decimal): number {
  return new Decimal(rupees).times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

/** Integer paise -> rupees as a 2-decimal string, e.g. 720000 -> "7200.00". */
export function paiseToRupeeString(paise: number): string {
  return new Decimal(paise).dividedBy(100).toFixed(2);
}

/** Integer paise -> rupees as a number (for display only). */
export function paiseToRupees(paise: number): number {
  return new Decimal(paise).dividedBy(100).toNumber();
}

const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const inrWholeFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** ₹1,25,000.00 */
/** "₹1,234.00". null = hidden from this person (prices they may not see). */
export function formatINR(paise: number | null): string {
  return paise == null ? "Hidden" : inrFormatter.format(paiseToRupees(paise));
}

/** ₹36 or ₹22.50 (drops .00 for short in-sentence prices). */
export function formatINRShort(paise: number | null): string {
  if (paise == null) return "Hidden";
  return paise % 100 === 0 ? inrWholeFormatter.format(paiseToRupees(paise)) : inrFormatter.format(paiseToRupees(paise));
}

/** Indian grouping for plain quantities, e.g. 1,25,000.5 */
export function formatQty(qty: number | string): string {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(Number(qty));
}

// ---------------------------------------------------------------------------
// Price type
// ---------------------------------------------------------------------------

export function rateKindFor(category: Category): RateKind {
  return category === "MSME" ? "MSME" : "OEM";
}

export function rateKindLabel(kind: RateKind): string {
  return kind === "MSME" ? "MSME rate" : "OEM / Tier 1-2 rate";
}

export function priceTypeFor(
  customer: PricingCustomer,
  settings: PricingSettings = DEFAULT_PRICING_SETTINGS,
): PriceType {
  const rateKind = rateKindFor(customer.category);
  const eligible =
    customer.isMcciaMember && (rateKind === "MSME" || settings.applyDiscountToNonMsme);
  const discountPct = eligible ? settings.memberDiscountPct : 0;
  const base = rateKindLabel(rateKind);
  const pct = formatPct(discountPct);
  return {
    rateKind,
    discountPct,
    label: discountPct > 0 ? `${base}, less ${pct}% MCCIA member discount` : base,
    badge: discountPct > 0 ? `${base} + ${pct}% MCCIA member discount` : base,
  };
}

function formatPct(pct: number): string {
  return new Decimal(pct).toDecimalPlaces(2).toString();
}

// ---------------------------------------------------------------------------
// Rates
// ---------------------------------------------------------------------------

export interface RateCardService {
  /** Rupees, as stored in the database (numeric string or number). */
  rateMsme: number | string;
  rateOem: number | string;
}

export interface CustomerRate {
  listRatePaise: number;
  discountPct: number;
  finalRatePaise: number;
}

/** Apply a % discount to a rate in paise, rounded to the nearest paisa. */
export function applyDiscount(ratePaise: number, discountPct: number): number {
  if (!discountPct) return ratePaise;
  return new Decimal(ratePaise)
    .times(new Decimal(100).minus(discountPct))
    .dividedBy(100)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toNumber();
}

export function customerRate(service: RateCardService, priceType: PriceType): CustomerRate {
  const list = toPaise(priceType.rateKind === "MSME" ? service.rateMsme : service.rateOem);
  return {
    listRatePaise: list,
    discountPct: priceType.discountPct,
    finalRatePaise: applyDiscount(list, priceType.discountPct),
  };
}

// ---------------------------------------------------------------------------
// Quantities
// ---------------------------------------------------------------------------

export interface QuantityInputs {
  ccPerPart?: number | null;
  parts?: number | null;
  hours?: number | null;
  samples?: number | null;
  /** Used for custom items and anything with a plain quantity. */
  quantity?: number | null;
}

/** Number of chamber runs needed for a sample count (3 samples per run). */
export function runsForSamples(samples: number): number {
  if (!samples || samples <= 0) return 0;
  return Math.ceil(samples / SAMPLES_PER_RUN);
}

/** The quantity we charge for, based on how the service is charged. */
export function billableQuantity(unitType: UnitType | null, q: QuantityInputs): number {
  const n = (v: number | null | undefined) => (v && v > 0 ? v : 0);
  switch (unitType) {
    case "PER_CC":
      return new Decimal(n(q.ccPerPart)).times(n(q.parts)).toNumber();
    case "PER_HOUR":
      return n(q.hours);
    case "PER_SAMPLE":
      return n(q.samples);
    case "PER_HOUR_3_SAMPLES":
      return new Decimal(n(q.hours)).times(runsForSamples(n(q.samples))).toNumber();
    default:
      return n(q.quantity);
  }
}

/** Quantity breakdown in plain words, e.g. "50 cc x 4 parts = 200 cc". */
export function quantityInWords(
  unitType: UnitType | null,
  q: QuantityInputs,
  customUnit?: string | null,
): string {
  const qty = billableQuantity(unitType, q);
  const plural = (v: number, one: string, many: string) => `${formatQty(v)} ${v === 1 ? one : many}`;
  switch (unitType) {
    case "PER_CC":
      return `${formatQty(q.ccPerPart ?? 0)} cc x ${plural(q.parts ?? 0, "part", "parts")} = ${formatQty(qty)} cc`;
    case "PER_HOUR":
      return plural(qty, "hour", "hours");
    case "PER_SAMPLE":
      return plural(qty, "sample", "samples");
    case "PER_HOUR_3_SAMPLES": {
      const runs = runsForSamples(q.samples ?? 0);
      return `${plural(q.hours ?? 0, "hour", "hours")} x ${plural(runs, "run", "runs")} (${plural(q.samples ?? 0, "sample", "samples")}) = ${formatQty(qty)} hours`;
    }
    default:
      return `${formatQty(qty)}${customUnit ? ` ${customUnit}` : ""}`;
  }
}

/** quantity x rate, rounded to the nearest paisa. */
export function lineAmount(qty: number, ratePaise: number): number {
  return new Decimal(qty).times(ratePaise).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

// ---------------------------------------------------------------------------
// Quotation lines and totals
// ---------------------------------------------------------------------------

export interface LineInput {
  billableQty: number;
  /** Rate before any member discount (rate card rate, or the custom rate). */
  listRatePaise: number;
  /** 0 for custom items and custom-rate lines. */
  discountPct: number;
}

export interface LineResult {
  billableQty: number;
  listRatePaise: number;
  discountPct: number;
  finalRatePaise: number;
  /** quantity x list rate */
  grossPaise: number;
  /** quantity x final rate (what the customer pays before GST) */
  amountPaise: number;
  discountPaise: number;
}

export function calculateLine(line: LineInput): LineResult {
  const finalRatePaise = applyDiscount(line.listRatePaise, line.discountPct);
  const grossPaise = lineAmount(line.billableQty, line.listRatePaise);
  const amountPaise = lineAmount(line.billableQty, finalRatePaise);
  return {
    billableQty: line.billableQty,
    listRatePaise: line.listRatePaise,
    discountPct: line.discountPct,
    finalRatePaise,
    grossPaise,
    amountPaise,
    discountPaise: grossPaise - amountPaise,
  };
}

export interface TaxContext {
  /** Two digit GST state code of the customer, e.g. "27". */
  customerStateCode: string | null | undefined;
}

export interface Totals {
  subtotalPaise: number;
  discountPaise: number;
  taxablePaise: number;
  intraState: boolean;
  gstPct: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  /** Before rounding to the nearest rupee. */
  totalBeforeRoundPaise: number;
  /** Can be negative, e.g. -40 for "- ₹0.40". */
  roundOffPaise: number;
  grandTotalPaise: number;
  amountInWords: string;
}

/** Percentage of a paise amount, rounded to the nearest paisa. */
function pctOf(paise: number, pct: number): number {
  return new Decimal(paise).times(pct).dividedBy(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

export function calculateTotals(
  lines: LineInput[],
  tax: TaxContext,
  settings: PricingSettings = DEFAULT_PRICING_SETTINGS,
): Totals {
  const results = lines.map(calculateLine);
  const subtotalPaise = results.reduce((s, l) => s + l.grossPaise, 0);
  const taxablePaise = results.reduce((s, l) => s + l.amountPaise, 0);
  const discountPaise = subtotalPaise - taxablePaise;

  const intraState = !tax.customerStateCode || tax.customerStateCode === settings.homeStateCode;
  let cgstPaise = 0;
  let sgstPaise = 0;
  let igstPaise = 0;
  if (intraState) {
    const half = new Decimal(settings.gstPct).dividedBy(2).toNumber();
    cgstPaise = pctOf(taxablePaise, half);
    sgstPaise = pctOf(taxablePaise, half);
  } else {
    igstPaise = pctOf(taxablePaise, settings.gstPct);
  }

  const totalBeforeRoundPaise = taxablePaise + cgstPaise + sgstPaise + igstPaise;
  const grandTotalPaise = Math.round(totalBeforeRoundPaise / 100) * 100;
  const roundOffPaise = grandTotalPaise - totalBeforeRoundPaise;

  return {
    subtotalPaise,
    discountPaise,
    taxablePaise,
    intraState,
    gstPct: settings.gstPct,
    cgstPaise,
    sgstPaise,
    igstPaise,
    totalBeforeRoundPaise,
    roundOffPaise,
    grandTotalPaise,
    amountInWords: amountInWords(grandTotalPaise),
  };
}

// ---------------------------------------------------------------------------
// Amount in words (Indian system: thousand, lakh, crore)
// ---------------------------------------------------------------------------

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  const t = TENS[Math.floor(n / 10)];
  const o = n % 10;
  return o ? `${t}-${ONES[o]}` : t;
}

function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (h) parts.push(`${ONES[h]} Hundred`);
  if (rest) parts.push(twoDigits(rest));
  return parts.join(" ");
}

/** Whole number in Indian words, e.g. 125000 -> "One Lakh Twenty-Five Thousand". */
export function numberToIndianWords(num: number): string {
  num = Math.floor(Math.abs(num));
  if (num === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(num / 10_000_000);
  num %= 10_000_000;
  const lakh = Math.floor(num / 100_000);
  num %= 100_000;
  const thousand = Math.floor(num / 1000);
  num %= 1000;
  if (crore) parts.push(`${numberToIndianWords(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (num) parts.push(threeDigits(num));
  return parts.join(" ");
}

/** e.g. 849600 paise -> "Rupees Eight Thousand Four Hundred Ninety-Six Only" */
export function amountInWords(paise: number): string {
  const rupees = Math.floor(Math.abs(paise) / 100);
  const p = Math.abs(paise) % 100;
  let words = `Rupees ${numberToIndianWords(rupees)}`;
  if (p) words += ` and ${twoDigits(p)} Paise`;
  return `${words} Only`;
}

// ---------------------------------------------------------------------------
// Quotation numbering
// ---------------------------------------------------------------------------

/** Indian financial year (April to March) for a date, e.g. 2026-11-18 -> "2026-27". */
export function financialYear(date: Date): string {
  const y = date.getFullYear();
  const start = date.getMonth() >= 3 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** e.g. ("ACDRI/QT", "2026-27", 1) -> "ACDRI/QT/2026-27/0001" */
export function formatQuoteNo(prefix: string, fy: string, seq: number): string {
  return `${prefix}/${fy}/${String(seq).padStart(4, "0")}`;
}
