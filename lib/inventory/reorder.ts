/**
 * Reorder list (brief section 8): the suggested quantity, the order lines sent to a supplier,
 * and the WhatsApp / email links. Pure and unit-tested.
 */
import Decimal from "decimal.js";
import { whatsappNumber } from "@/lib/reminders";
import { D, formatQty, packWord } from "./numbers";
import { fillOrderTemplate } from "./templates";

/**
 * Suggested quantity (in the item's unit): the reorder quantity; if none is set, enough to bring
 * stock up to twice the reorder level. Rounded up to whole packs when the item has a pack size.
 * "0" means there is nothing to suggest (staff type the quantity).
 */
export function suggestedQty(p: { qty: Decimal.Value; reorderLevel: Decimal.Value; reorderQty: Decimal.Value; packSize?: Decimal.Value | null }): string {
  let q = D(p.reorderQty);
  if (q.lte(0)) q = Decimal.max(D(p.reorderLevel).mul(2).sub(D(p.qty)), 0);
  const size = D(p.packSize ?? 0);
  if (q.gt(0) && size.gt(0)) q = q.div(size).ceil().mul(size);
  return q.toDecimalPlaces(3).toFixed();
}

export interface OrderLine {
  name: string;
  qty: Decimal.Value;
  unit: string;
  packName?: string | null;
  packSize?: Decimal.Value | null;
}

/** "3 bottles of 1,000 ml (3,000 ml)" when the quantity is whole packs, otherwise "500 pcs". */
export function orderQtyText(l: OrderLine): string {
  const size = D(l.packSize ?? 0);
  if (l.packName && size.gt(0)) {
    const packs = D(l.qty).div(size);
    if (packs.isInteger() && packs.gt(0)) return `${formatQty(packs)} ${packWord(packs, l.packName)} of ${formatQty(size, l.unit)} (${formatQty(l.qty, l.unit)})`;
  }
  return formatQty(l.qty, l.unit);
}

/** The {items} part of the message: one numbered line per item. */
export function orderItemsText(lines: OrderLine[]): string {
  return lines.map((l, i) => `${i + 1}. ${l.name}: ${orderQtyText(l)}`).join("\n");
}

export interface OrderLinks {
  message: string;
  subject: string;
  body: string;
  whatsappUrl: string | null;
  mailtoUrl: string | null;
}

export function orderLinks(
  supplier: { name: string; contactName: string | null; phone: string | null; email: string | null },
  lines: OrderLine[],
  templates: { whatsapp: string; emailSubject: string; emailBody: string },
  values: { orgName: string; date: string },
): OrderLinks {
  const v = { supplier: supplier.name, contact_name: supplier.contactName?.trim() || `${supplier.name} team`, items: orderItemsText(lines), org_name: values.orgName, date: values.date };
  const message = fillOrderTemplate(templates.whatsapp, v);
  const subject = fillOrderTemplate(templates.emailSubject, v);
  const body = fillOrderTemplate(templates.emailBody, v);
  const wa = supplier.phone ? whatsappNumber(supplier.phone) : null;
  const email = supplier.email?.trim();
  return {
    message,
    subject,
    body,
    whatsappUrl: wa ? `https://wa.me/${wa}?text=${encodeURIComponent(message)}` : null,
    mailtoUrl: email ? `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` : null,
  };
}
