/**
 * "Tell the customer it's ready" (Today > Done). Editable in Settings > Planning.
 * Placeholders: {contact_name} {company} {job_no} {service} {org_name}
 */
export const DEFAULT_READY_WHATSAPP_TEMPLATE = `Dear {contact_name},

Your job {job_no} ({service}) for {company} is ready. Please let us know when you would like to collect it, or if you need the report sent first.

Thank you,
{org_name}`;

export const READY_TEMPLATE_PLACEHOLDERS = ["{contact_name}", "{company}", "{job_no}", "{service}", "{org_name}"] as const;

export type ReadyTemplateValues = { contact_name: string; company: string; job_no: string; service: string; org_name: string };

export function fillReadyTemplate(template: string, values: ReadyTemplateValues): string {
  return template.replace(/\{(\w+)\}/g, (m, key: string) => (key in values ? values[key as keyof ReadyTemplateValues] : m));
}
