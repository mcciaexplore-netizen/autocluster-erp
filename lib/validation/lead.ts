import { z } from "zod";
import { emailProblem, mobileProblem, normalizeMobile } from "@/lib/crm/contact";
import { parseRupees } from "@/lib/money-input";

/** The enquiry form, as typed (strings), shared by the browser and the server. */
export const leadFormSchema = z
  .object({
    title: z.string().trim().min(1, { message: "Please enter the enquiry title, e.g. “3D printing of 20 prototype parts”." }).max(200, { message: "Please keep the title under 200 characters." }),
    sourceId: z.string().min(1, { message: "Please choose where the enquiry came from." }),
    deptCodes: z.array(z.string()).max(10),
    serviceIds: z.array(z.number().int()).max(100),
    expectedValue: z
      .string()
      .trim()
      .max(20)
      .refine((v) => !v || parseRupees(v) != null, { message: "Enter an amount in rupees, e.g. 50000 or 1,25,000." }),
    expectedCloseDate: z
      .string()
      .trim()
      .refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), { message: "Please choose a date." }),
    priority: z.number().int().min(0).max(3),
    assignedTo: z.string(),
    tagIds: z.array(z.string()).max(30),
    stageId: z.string().min(1, { message: "Please choose a stage." }),
    existingCustomer: z.boolean(),
    customerId: z.string(),
    companyName: z.string().trim().min(1, { message: "Please enter the company name." }).max(200),
    contactName: z.string().trim().min(1, { message: "Please enter the contact person's name." }).max(120),
    designation: z.string().trim().max(120),
    phone: z.string().trim().max(20).refine((v) => !mobileProblem(v), { message: "The mobile number should have 10 digits, starting with 6, 7, 8 or 9." }),
    email: z.string().trim().max(200).refine((v) => !emailProblem(v), { message: "This email address doesn't look right, e.g. name@company.com." }),
    city: z.string().trim().max(80),
    category: z.enum(["", "OEM", "TIER1", "TIER2", "MSME"]),
    isMcciaMember: z.enum(["", "yes", "no"]),
    mcciaMembershipId: z.string().trim().max(60),
    notes: z.string().max(5000),
  })
  .superRefine((v, ctx) => {
    if (!normalizeMobile(v.phone) && !v.email.trim()) {
      ctx.addIssue({ code: "custom", path: ["phone"], message: "Please enter a mobile number or an email address (at least one)." });
    }
    if (v.existingCustomer && !v.customerId) ctx.addIssue({ code: "custom", path: ["customerId"], message: "Please choose the customer, or turn off “Existing customer”." });
  });

export type LeadFormValues = z.infer<typeof leadFormSchema>;

export const EMPTY_LEAD_FORM: LeadFormValues = {
  title: "",
  sourceId: "",
  deptCodes: [],
  serviceIds: [],
  expectedValue: "",
  expectedCloseDate: "",
  priority: 0,
  assignedTo: "",
  tagIds: [],
  stageId: "",
  existingCustomer: false,
  customerId: "",
  companyName: "",
  contactName: "",
  designation: "",
  phone: "",
  email: "",
  city: "",
  category: "",
  isMcciaMember: "",
  mcciaMembershipId: "",
  notes: "",
};

/** Form values -> the writer's input. */
export function leadInputFromForm(v: LeadFormValues) {
  return {
    title: v.title,
    sourceId: v.sourceId || null,
    stageId: v.stageId || null,
    customerId: v.existingCustomer && v.customerId ? v.customerId : null,
    companyName: v.companyName,
    contactName: v.contactName,
    designation: v.designation || null,
    phone: v.phone || null,
    email: v.email || null,
    city: v.city || null,
    category: v.category || null,
    isMcciaMember: v.isMcciaMember === "" ? null : v.isMcciaMember === "yes",
    mcciaMembershipId: v.isMcciaMember === "yes" ? v.mcciaMembershipId || null : null,
    deptCodes: v.deptCodes,
    serviceIds: v.serviceIds,
    expectedValuePaise: v.expectedValue ? parseRupees(v.expectedValue) : null,
    expectedCloseDate: v.expectedCloseDate || null,
    priority: v.priority,
    assignedTo: v.assignedTo || null,
    tagIds: v.tagIds,
    notes: v.notes.trim() || null,
  };
}
