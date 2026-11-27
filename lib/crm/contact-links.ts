/** Ready-written enquiry messages: tel:, WhatsApp (wa.me) and email (mailto:) links. Pure. */
import { whatsappNumber } from "@/lib/reminders";
import { fillLeadTemplate } from "./templates";

export interface LeadContactLinks {
  telUrl: string | null;
  whatsappUrl: string | null;
  mailtoUrl: string | null;
  message: string;
  subject: string;
  body: string;
}

export function leadContactLinks(
  lead: { contactName: string; companyName: string; title: string; phone: string | null; email: string | null },
  templates: { whatsapp: string; emailSubject: string; emailBody: string },
  orgName = "",
): LeadContactLinks {
  const values = { contact_name: lead.contactName, company: lead.companyName, enquiry_title: lead.title, org_name: orgName };
  const message = fillLeadTemplate(templates.whatsapp, values);
  const subject = fillLeadTemplate(templates.emailSubject, values);
  const body = fillLeadTemplate(templates.emailBody, values);
  const wa = lead.phone ? whatsappNumber(lead.phone) : null;
  return {
    telUrl: wa ? `tel:+${wa}` : null,
    whatsappUrl: wa ? `https://wa.me/${wa}?text=${encodeURIComponent(message)}` : null,
    mailtoUrl: lead.email ? `mailto:${lead.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` : null,
    message,
    subject,
    body,
  };
}
