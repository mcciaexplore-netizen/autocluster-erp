/**
 * Enquiry contact templates. Editable in Settings > CRM.
 * Placeholders: {contact_name} {company} {enquiry_title}
 */
export const DEFAULT_LEAD_WHATSAPP_TEMPLATE =
  "Dear {contact_name}, thank you for your enquiry with ACDRI AutoCluster, Pune about {enquiry_title}. We will be happy to help. Please let us know a convenient time to discuss.";

export const DEFAULT_LEAD_EMAIL_SUBJECT_TEMPLATE = "Your enquiry with ACDRI AutoCluster, Pune: {enquiry_title}";

export const DEFAULT_LEAD_EMAIL_BODY_TEMPLATE = `Dear {contact_name},

Thank you for your enquiry with ACDRI AutoCluster, Pune about {enquiry_title}.

We will be happy to help {company}. Please let us know a convenient time to discuss your requirement, or reply to this email with any drawings or details.

Thank you.

ACDRI AutoCluster, Pune`;

export const LEAD_TEMPLATE_PLACEHOLDERS = ["{contact_name}", "{company}", "{enquiry_title}"] as const;

export type LeadTemplateValues = { contact_name: string; company: string; enquiry_title: string };

/** Replaces {placeholders} with values. Unknown placeholders are left as they are. */
export function fillLeadTemplate(template: string, values: LeadTemplateValues): string {
  return template.replace(/\{(\w+)\}/g, (m, key: string) => (key in values ? values[key as keyof LeadTemplateValues] : m));
}
