import { z } from "zod";

export const MACHINE_STATUS = {
  AVAILABLE: { label: "In service", className: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  MAINTENANCE: { label: "Under maintenance", className: "border-amber-200 bg-amber-50 text-amber-900" },
  BREAKDOWN: { label: "Breakdown", className: "border-red-200 bg-red-50 text-red-800" },
  INACTIVE: { label: "Inactive", className: "border-slate-200 bg-slate-50 text-slate-600" },
} as const;
export type MachineStatusName = keyof typeof MACHINE_STATUS;

export const BLOCK_TYPES = {
  MAINTENANCE: "Maintenance",
  CALIBRATION: "Calibration",
  BREAKDOWN: "Breakdown",
  INTERNAL: "Internal use / R&D",
  OTHER: "Other",
} as const;
export type BlockTypeName = keyof typeof BLOCK_TYPES;

const text = (max: number, msg: string) => z.string().trim().max(max, { message: msg });

export const machineFormSchema = z.object({
  name: z.string().trim().min(1, { message: "Please enter the machine name, e.g. “SLA - 3D Systems 7000 HD”." }).max(120, { message: "Keep the name under 120 characters." }),
  code: z
    .string()
    .trim()
    .max(20, { message: "Keep the code short, e.g. MC-01." })
    .refine((v) => v === "" || /^[A-Za-z0-9/_.-]+$/.test(v), { message: "Use letters, numbers, / - _ or . only, e.g. MC-01." }),
  deptCode: z.string().min(1, { message: "Please choose the department." }),
  makeModel: text(120, "Keep the make and model under 120 characters."),
  keySpecs: text(1000, "Keep the key specs under 1,000 characters."),
  testStandards: text(500, "Keep the test standards under 500 characters."),
  nablAccredited: z.boolean(),
  serviceIds: z.array(z.number().int().positive()).max(100),
  parallelJobs: z.number({ message: "Enter a number, e.g. 1." }).int({ message: "Use a whole number." }).min(1, { message: "Use 1 or more." }).max(50, { message: "Use 50 or less." }),
  runsNonstop: z.boolean(),
  location: text(120, "Keep the place under 120 characters."),
  status: z.enum(["AVAILABLE", "MAINTENANCE", "BREAKDOWN", "INACTIVE"]),
  notes: z.string().max(2000),
});
export type MachineFormValues = z.infer<typeof machineFormSchema>;

export const EMPTY_MACHINE_FORM: MachineFormValues = {
  name: "",
  code: "",
  deptCode: "",
  makeModel: "",
  keySpecs: "",
  testStandards: "",
  nablAccredited: false,
  serviceIds: [],
  parallelJobs: 1,
  runsNonstop: false,
  location: "",
  status: "AVAILABLE",
  notes: "",
};

/** "2026-11-30T09:30" from a date-time box (India time). */
export const LOCAL_DT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
