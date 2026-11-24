/** Removing money fields on the server (section 3.4): the value becomes null and never reaches the browser. */
export type Blanked<O, K extends PropertyKey> = { [P in keyof O]: P extends K ? O[P] | null : O[P] };

export function blankKeys<O extends object, K extends string>(o: O, keys: readonly K[]): Blanked<O, K> {
  const out: Record<string, unknown> = { ...(o as Record<string, unknown>) };
  for (const k of keys) if (k in out) out[k] = null;
  return out as Blanked<O, K>;
}

/** Stock-cost fields in Inventory data (purchase rates, average cost, values). */
const STOCK_COST_KEYS = new Set([
  "avgCost", "unitCost", "rate", "lastRate", "lastPurchaseRate", "value", "valuePaise", "valueInPaise", "valueOutPaise", "costPaise",
  "lossPaise", "gainPaise", "boughtThisYearPaise", "stockValuePaise", "totalValuePaise", "valueUsedPaise", "ratePaise", "amountPaise",
]);
const STOCK_COST_LISTS = new Set(["supplierRates", "priceHistory"]);

/**
 * Removes every stock-cost field (any depth) for people who may not see stock costs: values become
 * null and price lists become empty. Applied by the Inventory loaders, so pages, exports and PDFs
 * never get them.
 */
export function stripStockCosts<T>(data: T): T {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v instanceof Map) return new Map([...v].map(([k, x]) => [k, walk(x)]));
    if (v && typeof v === "object" && !(v instanceof Date)) {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) out[k] = STOCK_COST_KEYS.has(k) ? null : STOCK_COST_LISTS.has(k) ? [] : walk(x);
      return out;
    }
    return v;
  };
  return walk(data) as T;
}
