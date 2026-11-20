/**
 * Materials for jobs: suggestions from a service's materials list, stock hints, and
 * "kept after materials". Pure (no database), shared by the server and the screens.
 */
import Decimal from "decimal.js";
import { D, formatQty } from "./numbers";

export interface Material {
  itemId: string;
  name: string;
  unit: string;
  /** How much of the item one billing unit of the service uses, e.g. 1.15 (ml per cc). */
  qtyPerUnit: string;
  /** Current stock of the item. */
  inStock: string;
}

export interface Suggestion extends Material {
  qty: string;
  /** e.g. "200 cc × 1.15 ml per cc = 230 ml" */
  explain: string;
}

/** "per cc" -> "cc"; "per hour (up to 3 samples)" -> "hour"; "per sample" -> "sample". */
export function billingUnitName(unitLabel: string): string {
  return unitLabel.replace(/\(.*?\)/g, "").replace(/^\s*per\s+/i, "").trim() || "unit";
}

/** Suggested quantity of each material = the ticket's billable quantity x the amount per unit. */
export function suggestMaterials(billableQty: Decimal.Value, unitLabel: string, materials: Material[]): Suggestion[] {
  const billUnit = billingUnitName(unitLabel);
  return materials.map((m) => {
    const qty = D(billableQty).mul(D(m.qtyPerUnit)).toDecimalPlaces(3, Decimal.ROUND_HALF_UP);
    return {
      ...m,
      qty: qty.toFixed(),
      explain: `${formatQty(billableQty)} ${billUnit} × ${formatQty(m.qtyPerUnit)} ${m.unit} per ${billUnit} = ${formatQty(qty, m.unit)}`,
    };
  });
}

/** Green "Enough stock", or amber "Low stock: SLA resin (needs ~230 ml, 150 ml in stock)". Never blocks anything. */
export function stockHint(suggestions: Suggestion[]): { ok: boolean; text: string } | null {
  if (!suggestions.length) return null;
  const short = suggestions.filter((s) => D(s.qty).gt(D(s.inStock)));
  if (!short.length) return { ok: true, text: "Enough stock" };
  return { ok: false, text: `Low stock: ${short.map((s) => `${s.name} (needs ~${formatQty(s.qty, s.unit)}, ${formatQty(s.inStock, s.unit)} in stock)`).join("; ")}` };
}

/** Kept after materials = ticket value before GST - material cost, as ₹ and % (1 decimal). */
export function keptAfterMaterials(valuePaise: number, materialPaise: number): { keptPaise: number; pct: number | null } {
  const kept = valuePaise - materialPaise;
  return { keptPaise: kept, pct: valuePaise > 0 ? new Decimal(kept).div(valuePaise).mul(100).toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toNumber() : null };
}
