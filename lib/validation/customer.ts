import { z } from "zod";
import { GSTIN_REGEX, MOBILE_REGEX, PAN_REGEX, PINCODE_REGEX, stateByCode, TAN_REGEX } from "@/lib/india";

/** Friendly message for a GST number, or null when it is fine. */
export function gstinProblem(v: string): string | null {
  if (!v) return "Please enter the GST number, or tick “Not registered under GST”.";
  if (v.length < 15) return "This GST number looks too short. It should have 15 characters.";
  if (v.length > 15) return "This GST number looks too long. It should have 15 characters.";
  if (!/^[0-9]{2}/.test(v)) return "A GST number starts with 2 digits for the state, e.g. 27 for Maharashtra.";
  if (!stateByCode(v.slice(0, 2))) return `“${v.slice(0, 2)}” is not a valid state code. Please check the first 2 digits.`;
  if (!GSTIN_REGEX.test(v)) return "This GST number doesn't look right. Please check it, e.g. 27AABCU9603R1ZM.";
  return null;
}

const req = (msg: string) => z.string().trim().min(1, { message: msg });
const opt = z.string().trim();

/** Step 1: company, contact person, MCCIA membership. */
export const customerDetailsSchema = z
  .object({
    companyName: req("Please enter the company name."),
    category: z.enum(["OEM", "TIER1", "TIER2", "MSME"], { message: "Please choose the company category." }),
    udyamNo: opt,
    addressLine1: req("Please enter the address."),
    addressLine2: opt,
    city: req("Please enter the city."),
    pincode: z.string().trim().regex(PINCODE_REGEX, { message: "Pincode should be 6 digits, e.g. 411018." }),
    stateCode: z.string().refine((v) => !!stateByCode(v), { message: "Please choose the state." }),
    notGstRegistered: z.boolean(),
    gstin: opt,
    pan: z
      .string()
      .trim()
      .min(1, { message: "Please enter the PAN." })
      .regex(PAN_REGEX, { message: "PAN should be 10 characters: 5 letters, 4 digits, 1 letter, e.g. AABCU9603R." }),
    tan: z
      .string()
      .trim()
      .refine((v) => !v || TAN_REGEX.test(v), {
        message: "TAN should be 10 characters: 4 letters, 5 digits, 1 letter, e.g. PNEA12345B.",
      }),
    pocName: req("Please enter the contact person's name."),
    pocDesignation: opt,
    pocPhone: z
      .string()
      .trim()
      .regex(MOBILE_REGEX, { message: "Please enter a 10-digit mobile number starting with 6, 7, 8 or 9." }),
    pocEmail: z
      .string()
      .trim()
      .min(1, { message: "Please enter an email address." })
      .email({ message: "This email address doesn't look right, e.g. name@company.com." }),
    isMcciaMember: z.enum(["yes", "no"], { message: "Please choose Yes or No." }),
    mcciaMembershipId: opt,
    creditDays: z
      .string()
      .trim()
      .regex(/^\d{1,3}$/, { message: "Please enter the number of days, e.g. 30." })
      .refine((v) => Number(v) <= 365, { message: "Credit period can be at most 365 days." }),
  })
  // `when` makes these cross-field checks run even while other fields still have
  // errors, so every problem is shown at once.
  .superRefine(
    (v, ctx) => {
      if (!v.notGstRegistered) {
        const p = gstinProblem(String(v.gstin ?? "").trim().toUpperCase());
        if (p) ctx.addIssue({ code: "custom", path: ["gstin"], message: p });
      }
      if (v.isMcciaMember === "yes" && !String(v.mcciaMembershipId ?? "").trim()) {
        ctx.addIssue({ code: "custom", path: ["mcciaMembershipId"], message: "Please enter the MCCIA Membership ID." });
      }
    },
    { when: (payload) => typeof payload.value === "object" && payload.value !== null },
  );

export type CustomerDetailsInput = z.input<typeof customerDetailsSchema>;
export type CustomerDetails = z.output<typeof customerDetailsSchema>;

export const EMPTY_CUSTOMER_DETAILS: CustomerDetailsInput = {
  companyName: "",
  // Empty until chosen; the schema asks the user to pick one.
  category: "" as unknown as "MSME",
  udyamNo: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  pincode: "",
  stateCode: "",
  notGstRegistered: false,
  gstin: "",
  pan: "",
  tan: "",
  pocName: "",
  pocDesignation: "",
  pocPhone: "",
  pocEmail: "",
  creditDays: "30",
  isMcciaMember: "" as unknown as "no",
  mcciaMembershipId: "",
};

export const customerLinksSchema = z.object({
  deptCodes: z.array(z.string()).min(1, { message: "Please choose at least one department." }),
  serviceIds: z.array(z.number().int()),
});
