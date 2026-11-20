/**
 * Inventory numbers. Quantities have up to 3 decimals, unit costs up to 4 decimals (rupees),
 * values are whole paise. Everything uses decimal.js, never floating point. Pure.
 */
import Decimal from "decimal.js";

export const D = (v: Decimal.Value | null | undefined) => new Decimal(v == null || v === "" ? 0 : v);

/** Text typed by staff ("1,250.5") -> "1250.5" with at most 3 decimals, or null when it isn't a quantity. */
export function parseQty(text: string | number | null | undefined): string | null {
  const s = String(text ?? "").replace(/[,\s]/g, "");
  if (!/^\d+(\.\d{1,3})?$/.test(s)) return null;
  return new Decimal(s).toFixed();
}

/** Rate in rupees ("₹4.5", "0.0525") -> string with at most 4 decimals, or null. */
export function parseRate(text: string | number | null | undefined): string | null {
  const s = String(text ?? "").replace(/[,₹\s]/g, "");
  if (!/^\d+(\.\d{1,4})?$/.test(s)) return null;
  return new Decimal(s).toFixed();
}

/** Value in paise of qty x unit cost (rupees), rounded to the paisa. */
export function valuePaise(qty: Decimal.Value, unitCost: Decimal.Value): number {
  return D(qty).mul(D(unitCost)).mul(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

/** Database text for a quantity (3 decimals) and a rate (4 decimals). */
export const qtyText = (v: Decimal.Value) => D(v).toDecimalPlaces(3, Decimal.ROUND_HALF_UP).toFixed(3);
export const rateText = (v: Decimal.Value) => D(v).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);

const qtyFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 });
/** 1450 -> "1,450"; 2.5 -> "2.5"; with a unit: "1,450 ml". */
export function formatQty(v: Decimal.Value | null | undefined, unit?: string | null): string {
  const n = qtyFmt.format(D(v).toDecimalPlaces(3).toNumber());
  return unit ? `${n} ${unit}` : n;
}

/** ₹4.5 -> "₹4.50"; ₹0.0525 -> "₹0.0525" (keeps small rates readable). */
export function formatRate(v: Decimal.Value | null | undefined): string {
  const d = D(v);
  const places = d.decimalPlaces() > 2 ? Math.min(4, d.decimalPlaces()) : 2;
  return `₹${new Intl.NumberFormat("en-IN", { minimumFractionDigits: places, maximumFractionDigits: places }).format(d.toNumber())}`;
}

/** Packs: "3 bottles of 1000 ml" -> 3000 (in the item's unit). */
export function packsToUnits(packs: Decimal.Value, packSize: Decimal.Value): string {
  return D(packs).mul(D(packSize)).toFixed();
}

/** Rate per pack -> rate per unit (4 decimals). */
export function packRateToUnitRate(packRate: Decimal.Value, packSize: Decimal.Value): string {
  const size = D(packSize);
  if (size.lte(0)) throw new Error("Pack size must be more than 0.");
  return D(packRate).div(size).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed();
}

/** "3 bottles of 1,000 ml = 3,000 ml" (helper text under a quantity). */
export function packText(packs: Decimal.Value, packName: string, packSize: Decimal.Value, unit: string): string {
  const n = D(packs);
  const name = n.eq(1) ? packName.toLowerCase() : pluralise(packName.toLowerCase());
  return `${formatQty(n)} ${name} of ${formatQty(packSize, unit)} = ${formatQty(n.mul(D(packSize)), unit)}`;
}

function pluralise(w: string) {
  if (/(s|x|ch|sh)$/.test(w)) return `${w}es`;
  if (/[^aeiou]y$/.test(w)) return `${w.slice(0, -1)}ies`;
  return `${w}s`;
}
