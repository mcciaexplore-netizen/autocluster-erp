/** Stock status and other item rules shown on lists and cards. Pure. */
import { D } from "./numbers";

export type StockStatus = "in" | "low" | "out";

export const STATUS_CHIP = {
  in: { label: "In stock", className: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  low: { label: "Low", className: "border-amber-300 bg-amber-50 text-amber-800" },
  out: { label: "Out of stock", className: "border-red-200 bg-red-50 text-red-700" },
  expiring: { label: "Expiring soon", className: "border-violet-200 bg-violet-50 text-violet-800" },
} as const;

/** Out at 0; Low at or below the reorder level; otherwise In stock. */
export function stockStatus(qty: string | number, reorderLevel: string | number): StockStatus {
  const q = D(qty);
  if (q.lte(0)) return "out";
  if (q.lte(D(reorderLevel))) return "low";
  return "in";
}
