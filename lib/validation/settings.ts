import { z } from "zod";
import { GSTIN_REGEX, stateByCode } from "@/lib/india";

export const settingsSchema = z.object({
  orgName: z.string().trim().min(1, { message: "Please enter the organisation name." }),
  orgAddress: z.string().trim().min(1, { message: "Please enter the address." }),
  orgGstin: z.string().trim().toUpperCase().regex(GSTIN_REGEX, { message: "This GST number doesn't look right. It should have 15 characters, e.g. 27AABCU9603R1ZM." }),
  orgPhone: z.string().trim().min(6, { message: "Please enter a phone number." }),
  orgEmail: z.string().trim().email({ message: "This email address doesn't look right, e.g. info@company.com." }),
  memberDiscountPct: z.number({ message: "Enter a number, e.g. 10." }).min(0, { message: "Use 0 or more." }).max(100, { message: "Use 100 or less." }),
  applyDiscountToNonMsme: z.boolean(),
  gstPct: z.number({ message: "Enter a number, e.g. 18." }).min(0, { message: "Use 0 or more." }).max(100, { message: "Use 100 or less." }),
  homeStateCode: z.string().refine((v) => !!stateByCode(v), { message: "Please choose a state." }),
  quoteValidityDays: z.number({ message: "Enter a number of days, e.g. 30." }).int({ message: "Use whole days." }).min(1, { message: "Use at least 1 day." }).max(365, { message: "Use 365 days or less." }),
  quotePrefix: z
    .string()
    .trim()
    .min(1, { message: "Please enter a prefix, e.g. ACDRI/QT." })
    .max(30, { message: "Keep the prefix short, e.g. ACDRI/QT." })
    .regex(/^[A-Za-z0-9/_-]+$/, { message: "Use letters, numbers, / - or _ only, e.g. ACDRI/QT." }),
  defaultTerms: z.string().trim().min(1, { message: "Please enter the terms." }).max(6000),
  ticketPrefix: z
    .string()
    .trim()
    .min(1, { message: "Please enter a prefix, e.g. ACDRI/TK." })
    .max(30, { message: "Keep the prefix short, e.g. ACDRI/TK." })
    .regex(/^[A-Za-z0-9/_-]+$/, { message: "Use letters, numbers, / - or _ only, e.g. ACDRI/TK." }),
  defaultCreditDays: z.number({ message: "Enter a number of days, e.g. 30." }).int({ message: "Use whole days." }).min(0, { message: "Use 0 or more." }).max(365, { message: "Use 365 days or less." }),
  whatsappTemplate: z.string().trim().min(10, { message: "Please write the WhatsApp message." }).max(1000, { message: "Please keep the message under 1,000 characters." }),
  emailSubjectTemplate: z.string().trim().min(3, { message: "Please write the email subject." }).max(200, { message: "Please keep the subject under 200 characters." }),
  emailBodyTemplate: z.string().trim().min(10, { message: "Please write the email message." }).max(4000, { message: "Please keep the message under 4,000 characters." }),
});
export type SettingsInput = z.input<typeof settingsSchema>;
