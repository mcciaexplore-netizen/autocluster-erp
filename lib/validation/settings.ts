import { z } from "zod";
import { GSTIN_REGEX, stateByCode } from "@/lib/india";

const prefix = (eg: string) =>
  z
    .string()
    .trim()
    .min(1, { message: `Please enter a prefix, e.g. ${eg}.` })
    .max(30, { message: `Keep the prefix short, e.g. ${eg}.` })
    .regex(/^[A-Za-z0-9/_-]+$/, { message: `Use letters, numbers, / - or _ only, e.g. ${eg}.` });
const days = (eg: string, min: number, max: number) =>
  z.number({ message: `Enter a number of days, ${eg}.` }).int({ message: "Use whole days." }).min(min, { message: `Use ${min} or more.` }).max(max, { message: `Use ${max} or less.` });
const time = (eg: string) => z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: `Enter a time, ${eg}.` });
const pct = (eg: string) => z.number({ message: `Enter a percentage, ${eg}.` }).int({ message: "Use a whole number." }).min(1, { message: "Use 1 or more." }).max(100, { message: "Use 100 or less." });

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
  // CRM
  leadPrefix: z
    .string()
    .trim()
    .min(1, { message: "Please enter a prefix, e.g. ACDRI/EN." })
    .max(30, { message: "Keep the prefix short, e.g. ACDRI/EN." })
    .regex(/^[A-Za-z0-9/_-]+$/, { message: "Use letters, numbers, / - or _ only, e.g. ACDRI/EN." }),
  leadWhatsappTemplate: z.string().trim().min(10, { message: "Please write the WhatsApp message." }).max(1000, { message: "Please keep the message under 1,000 characters." }),
  leadEmailSubjectTemplate: z.string().trim().min(3, { message: "Please write the email subject." }).max(200, { message: "Please keep the subject under 200 characters." }),
  leadEmailBodyTemplate: z.string().trim().min(10, { message: "Please write the email message." }).max(4000, { message: "Please keep the message under 4,000 characters." }),
  // Inventory
  invInPrefix: prefix("ACDRI/IN"),
  invOutPrefix: prefix("ACDRI/OUT"),
  invAdjPrefix: prefix("ACDRI/ADJ"),
  invItemPrefix: prefix("ITM"),
  invExpiryWarningDays: days("e.g. 30", 1, 365),
  invAvgUseDays: days("e.g. 90", 7, 730),
  invSafetyDays: days("e.g. 7", 0, 365),
  invDefaultLeadTimeDays: days("e.g. 14", 0, 365),
  invPriceRiseAlertPct: pct("e.g. 10"),
  invMaterialShareAlertPct: pct("e.g. 40"),
  invOrderWhatsappTemplate: z.string().trim().min(10, { message: "Please write the WhatsApp message." }).max(1500, { message: "Please keep the message under 1,500 characters." }),
  invOrderEmailSubjectTemplate: z.string().trim().min(3, { message: "Please write the email subject." }).max(200, { message: "Please keep the subject under 200 characters." }),
  invOrderEmailBodyTemplate: z.string().trim().min(10, { message: "Please write the email message." }).max(4000, { message: "Please keep the message under 4,000 characters." }),
  /** A stage id, or "" for "Don't move". */
  quoteCreatedMoveToStageId: z.union([z.literal(""), z.string().uuid({ message: "Please choose a stage." })]),
  // Planning
  workingDays: z.array(z.number().int().min(1).max(7)).min(1, { message: "Please choose at least one working day." }),
  shiftStart: time("e.g. 09:00"),
  shiftEnd: time("e.g. 18:00"),
  /** "" = no break. */
  breakStart: z.union([z.literal(""), time("e.g. 13:00")]),
  breakEnd: z.union([z.literal(""), time("e.g. 13:30")]),
  tentativeHoldDays: days("e.g. 7", 1, 90),
  overrunWarningPct: z.number({ message: "Enter a percentage, e.g. 50." }).int({ message: "Use a whole number." }).min(1, { message: "Use 1 or more." }).max(500, { message: "Use 500 or less." }),
  actualVsQuotedAlertPct: pct("e.g. 10"),
  readyWhatsappTemplate: z.string().trim().min(10, { message: "Please write the WhatsApp message." }).max(1500, { message: "Please keep the message under 1,500 characters." }),
}).superRefine((v, ctx) => {
  const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  if (m(v.shiftEnd) <= m(v.shiftStart)) ctx.addIssue({ code: "custom", path: ["shiftEnd"], message: "The shift should end after it starts, e.g. 09:00 to 18:00." });
  if (!!v.breakStart !== !!v.breakEnd) ctx.addIssue({ code: "custom", path: [v.breakStart ? "breakEnd" : "breakStart"], message: "Enter both break times, or leave both empty for no break." });
  else if (v.breakStart && v.breakEnd) {
    if (m(v.breakEnd) <= m(v.breakStart)) ctx.addIssue({ code: "custom", path: ["breakEnd"], message: "The break should end after it starts, e.g. 13:00 to 13:30." });
    else if (m(v.breakStart) <= m(v.shiftStart) || m(v.breakEnd) >= m(v.shiftEnd)) ctx.addIssue({ code: "custom", path: ["breakStart"], message: "The break should be inside the shift." });
  }
});
export type SettingsInput = z.input<typeof settingsSchema>;
