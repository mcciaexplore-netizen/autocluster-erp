import { z } from "zod";
import { emailProblem, mobileProblem } from "@/lib/crm/contact";
import { GSTIN_REGEX } from "@/lib/india";
import { parseQty } from "@/lib/inventory/numbers";

const qtyField = (label: string, required: boolean) =>
  z
    .string()
    .trim()
    .refine((v) => (required ? v !== "" : true), { message: `Please enter the ${label}.` })
    .refine((v) => v === "" || parseQty(v) != null, { message: `The ${label} should be a number with up to 3 decimals, e.g. 500 or 2.5.` });

export const itemFormSchema = z
  .object({
    name: z.string().trim().min(1, { message: "Please enter the item name, e.g. “SLA resin, imported (grey)”." }).max(120),
    code: z
      .string()
      .trim()
      .max(30, { message: "Keep the item code short, e.g. ITM-0001." })
      .refine((v) => v === "" || /^[A-Za-z0-9/_.-]+$/.test(v), { message: "Use letters, numbers, / - _ or . only, e.g. ITM-0001." }),
    categoryId: z.string().min(1, { message: "Please choose a category." }),
    deptCodes: z.array(z.string()).max(10),
    unitId: z.string().min(1, { message: "Please choose the unit." }),
    packName: z.string().trim().max(30),
    packSize: qtyField("pack size", false),
    reorderLevel: qtyField("reorder level", true),
    reorderQty: qtyField("reorder quantity", true),
    leadTimeDays: z
      .string()
      .trim()
      .refine((v) => v === "" || (/^\d{1,3}$/.test(v) && Number(v) <= 365), { message: "Enter whole days, e.g. 7 (up to 365)." }),
    preferredSupplierId: z.string(),
    storagePlace: z.string().trim().max(120),
    trackBatches: z.boolean(),
    hsnCode: z
      .string()
      .trim()
      .refine((v) => v === "" || /^\d{4,8}$/.test(v), { message: "The HSN code should have 4 to 8 digits, e.g. 3907." }),
    notes: z.string().max(2000),
    isActive: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.packName && !v.packSize) ctx.addIssue({ code: "custom", path: ["packSize"], message: "Please enter how much one pack holds, e.g. 1000." });
    if (v.packSize && !v.packName) ctx.addIssue({ code: "custom", path: ["packName"], message: "Please name the pack, e.g. Bottle." });
    if (v.packSize && parseQty(v.packSize) != null && Number(parseQty(v.packSize)) <= 0) ctx.addIssue({ code: "custom", path: ["packSize"], message: "The pack size must be more than 0." });
  });
export type ItemFormValues = z.infer<typeof itemFormSchema>;

export const EMPTY_ITEM_FORM: ItemFormValues = {
  name: "",
  code: "",
  categoryId: "",
  deptCodes: [],
  unitId: "",
  packName: "",
  packSize: "",
  reorderLevel: "",
  reorderQty: "",
  leadTimeDays: "",
  preferredSupplierId: "",
  storagePlace: "",
  trackBatches: false,
  hsnCode: "",
  notes: "",
  isActive: true,
};

export const supplierFormSchema = z.object({
  name: z.string().trim().min(1, { message: "Please enter the supplier name." }).max(120),
  contactName: z.string().trim().max(80),
  phone: z.string().trim().max(20).refine((v) => !mobileProblem(v), { message: "The mobile number should have 10 digits, starting with 6, 7, 8 or 9." }),
  email: z.string().trim().max(200).refine((v) => !emailProblem(v), { message: "This email address doesn't look right, e.g. name@company.com." }),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => v === "" || GSTIN_REGEX.test(v), { message: "This GST number doesn't look right. It should have 15 characters, e.g. 27AABCU9603R1ZM." }),
  address: z.string().trim().max(400),
  notes: z.string().max(2000),
  isActive: z.boolean(),
});
export type SupplierFormValues = z.infer<typeof supplierFormSchema>;

export const EMPTY_SUPPLIER_FORM: SupplierFormValues = { name: "", contactName: "", phone: "", email: "", gstin: "", address: "", notes: "", isActive: true };
