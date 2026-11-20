/** Order list download links: ?supplier=<id>&lines=<itemId>:<qty>,... Pure. */
import { parseQty } from "./numbers";
import { UUID_RE } from "./uuid";

export function orderListQuery(supplierId: string | null, lines: { itemId: string; qty: string }[]): string {
  const p = new URLSearchParams();
  if (supplierId) p.set("supplier", supplierId);
  p.set("lines", lines.map((l) => `${l.itemId}:${l.qty}`).join(","));
  return p.toString();
}

export function parseOrderListQuery(params: URLSearchParams): { supplierId: string | null; lines: { itemId: string; qty: string }[] } | null {
  const sup = params.get("supplier");
  if (sup && !UUID_RE.test(sup)) return null;
  const lines: { itemId: string; qty: string }[] = [];
  for (const part of (params.get("lines") ?? "").split(",").filter(Boolean).slice(0, 200)) {
    const [itemId, raw] = part.split(":");
    const qty = parseQty(raw);
    if (!UUID_RE.test(itemId ?? "") || qty == null) return null;
    lines.push({ itemId, qty });
  }
  return lines.length ? { supplierId: sup, lines } : null;
}
