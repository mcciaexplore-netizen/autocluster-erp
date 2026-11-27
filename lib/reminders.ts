/** Ready-written payment reminders (WhatsApp and email). Pure: safe in the browser and on the server. */
import { formatDate } from "./format";
import { paiseToRupees } from "./pricing";
import { fillTemplate, type TemplateValues } from "./reminder-templates";
import { daysBetween } from "./tickets";

const amountFmt = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** 8496 -> "8,496"; 4000.5 -> "4,000.5" (the template already has the ₹). */
export function amountForMessage(paise: number): string {
  const r = paiseToRupees(paise);
  return Number.isInteger(r) ? amountFmt.format(r) : new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(r);
}

/** Indian mobile number in wa.me form (91 + 10 digits), or null when it doesn't look like one. */
export function whatsappNumber(phone: string): string | null {
  let d = phone.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  if (d.length !== 10 || !/^[6-9]/.test(d)) return null;
  return `91${d}`;
}

export interface ReminderInput {
  templates: { whatsapp: string; emailSubject: string; emailBody: string };
  company: string;
  /** Your organisation (Settings > Organisation profile), for {org_name}. */
  orgName: string;
  contactName: string;
  phone: string;
  email: string;
  invoiceNo: string;
  invoiceDate: string;
  dueDate: string;
  leftPaise: number;
  today: string;
}

export interface Reminder {
  message: string;
  subject: string;
  body: string;
  whatsappUrl: string | null;
  mailtoUrl: string | null;
  phone: string;
  email: string;
}

export function buildReminder(r: ReminderInput): Reminder {
  const values: TemplateValues = {
    company: r.company,
    org_name: r.orgName,
    contact_name: r.contactName,
    invoice_no: r.invoiceNo,
    invoice_date: formatDate(r.invoiceDate),
    amount_due: amountForMessage(r.leftPaise),
    due_date: formatDate(r.dueDate),
    days_overdue: String(Math.max(0, daysBetween(r.dueDate, r.today))),
  };
  const message = fillTemplate(r.templates.whatsapp, values);
  const subject = fillTemplate(r.templates.emailSubject, values);
  const body = fillTemplate(r.templates.emailBody, values);
  const wa = whatsappNumber(r.phone);
  const email = r.email.trim();
  return {
    message,
    subject,
    body,
    whatsappUrl: wa ? `https://wa.me/${wa}?text=${encodeURIComponent(message)}` : null,
    // mailto wants %20 for spaces, not "+"
    mailtoUrl: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` : null,
    phone: r.phone,
    email,
  };
}
