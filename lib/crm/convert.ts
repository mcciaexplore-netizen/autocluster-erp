/** "Convert to customer": what the enquiry fills in on the customer form. Pure. */
import { MOBILE_REGEX } from "@/lib/india";
import type { CustomerDetailsInput } from "@/lib/validation/customer";
import { normalizeMobile } from "./contact";

export interface LeadForConvert {
  companyName: string;
  contactName: string;
  designation: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  category: "OEM" | "TIER1" | "TIER2" | "MSME" | null;
  isMcciaMember: boolean | null;
  mcciaMembershipId: string | null;
}

export function customerPrefillFromLead(l: LeadForConvert): Partial<CustomerDetailsInput> {
  const phone = normalizeMobile(l.phone);
  return {
    companyName: l.companyName,
    pocName: l.contactName,
    pocDesignation: l.designation ?? "",
    pocPhone: phone && MOBILE_REGEX.test(phone) ? phone : "",
    pocEmail: l.email ?? "",
    city: l.city ?? "",
    ...(l.category ? { category: l.category } : {}),
    ...(l.isMcciaMember != null ? { isMcciaMember: l.isMcciaMember ? ("yes" as const) : ("no" as const) } : {}),
    mcciaMembershipId: l.isMcciaMember ? (l.mcciaMembershipId ?? "") : "",
  };
}
