import type { Customer } from "@/db/schema";
import type { CustomerDetailsInput } from "@/lib/validation/customer";

export function toDetailsInput(c: Customer): CustomerDetailsInput {
  return {
    companyName: c.companyName,
    category: c.category,
    udyamNo: c.udyamNo ?? "",
    addressLine1: c.addressLine1,
    addressLine2: c.addressLine2 ?? "",
    city: c.city,
    pincode: c.pincode,
    stateCode: c.stateCode,
    notGstRegistered: !c.gstRegistered,
    gstin: c.gstin ?? "",
    pan: c.pan,
    tan: c.tan ?? "",
    pocName: c.pocName,
    pocDesignation: c.pocDesignation ?? "",
    pocPhone: c.pocPhone,
    pocEmail: c.pocEmail,
    isMcciaMember: c.isMcciaMember ? "yes" : "no",
    mcciaMembershipId: c.mcciaMembershipId ?? "",
    creditDays: String(c.creditDays),
  };
}
