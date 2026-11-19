/**
 * Payment reminder templates. Editable in Settings.
 * Placeholders: {company} {contact_name} {invoice_no} {invoice_date} {amount_due} {due_date} {days_overdue}
 */
export const DEFAULT_WHATSAPP_TEMPLATE =
  "Dear {contact_name}, this is a gentle reminder from AutoCluster, Pune. Invoice {invoice_no} dated {invoice_date} for ₹{amount_due} is due on {due_date}. Kindly arrange the payment. Thank you.";

export const DEFAULT_EMAIL_SUBJECT_TEMPLATE = "Payment reminder: Invoice {invoice_no} from AutoCluster, Pune";

export const DEFAULT_EMAIL_BODY_TEMPLATE = `Dear {contact_name},

This is a gentle reminder that Invoice {invoice_no} dated {invoice_date} for ₹{amount_due} from AutoCluster, Pune is due on {due_date}.

Kindly arrange the payment at the earliest. If it has already been made, please share the payment reference so we can update our records.

Thank you.

Accounts Team
AutoCluster, Pune`;

export const TEMPLATE_PLACEHOLDERS = ["{company}", "{contact_name}", "{invoice_no}", "{invoice_date}", "{amount_due}", "{due_date}", "{days_overdue}"] as const;

export type TemplateValues = {
  company: string;
  contact_name: string;
  invoice_no: string;
  invoice_date: string;
  amount_due: string;
  due_date: string;
  days_overdue: string;
};

/** Replaces {placeholders} with values. Unknown placeholders are left as they are. */
export function fillTemplate(template: string, values: TemplateValues): string {
  return template.replace(/\{(\w+)\}/g, (m, key: string) => (key in values ? values[key as keyof TemplateValues] : m));
}
