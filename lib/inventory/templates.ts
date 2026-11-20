/**
 * Supplier order messages (Reorder list > Send to supplier). Editable in Settings > Inventory.
 * Placeholders: {supplier} {contact_name} {items} {org_name} {date}
 */
export const DEFAULT_ORDER_WHATSAPP_TEMPLATE = `Dear {contact_name},

Please send the following items to ACDRI AutoCluster, Pune:
{items}

Kindly confirm the rates and delivery date. Thank you.`;

export const DEFAULT_ORDER_EMAIL_SUBJECT_TEMPLATE = "Order from ACDRI AutoCluster, Pune ({date})";

export const DEFAULT_ORDER_EMAIL_BODY_TEMPLATE = `Dear {contact_name},

Please supply the following items to ACDRI AutoCluster, Pune:

{items}

Kindly confirm the rates and the delivery date. Please mention our order date on the bill.

Thank you.

Stores, {org_name}`;

export const ORDER_TEMPLATE_PLACEHOLDERS = ["{supplier}", "{contact_name}", "{items}", "{org_name}", "{date}"] as const;

export type OrderTemplateValues = { supplier: string; contact_name: string; items: string; org_name: string; date: string };

export function fillOrderTemplate(template: string, values: OrderTemplateValues): string {
  return template.replace(/\{(\w+)\}/g, (m, key: string) => (key in values ? values[key as keyof OrderTemplateValues] : m));
}
