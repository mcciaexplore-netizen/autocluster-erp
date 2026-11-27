/**
 * Which company the demo data shows (db:reset and db:seed): DEMO_COMPANY=generic (the default) or acdri.
 * - generic: "Demo Manufacturing Co., Pune" with DMC/ numbers and the company line hidden under the logo,
 *   for showing ERPOne to any manufacturing company.
 * - acdri: the AutoCluster (ACDRI) profile and numbers, for showing AutoCluster itself.
 * Machines, rate card and stories are the same for both.
 */
export type DemoCompany = "generic" | "acdri";

export interface CompanyProfile {
  orgName: string;
  orgAddress: string;
  orgGstin: string;
  orgPhone: string;
  orgEmail: string;
  showOrgName: boolean;
  quotePrefix: string;
  ticketPrefix: string;
  leadPrefix: string;
  invInPrefix: string;
  invOutPrefix: string;
  invAdjPrefix: string;
}

/** Prefix of the sample tax invoices (they are uploaded documents, not numbered by ERPOne). */
export const INVOICE_PREFIX: Record<DemoCompany, string> = { generic: "DMC/INV", acdri: "MCCIA" };

/** The invoice prefix for the company already saved in Settings (found by its quotation prefix). */
export function invoicePrefixFor(quotePrefix: string): string {
  const company = (Object.keys(COMPANY_PROFILES) as DemoCompany[]).find((c) => COMPANY_PROFILES[c].quotePrefix === quotePrefix);
  return company ? INVOICE_PREFIX[company] : "INV";
}

export const COMPANY_PROFILES: Record<DemoCompany, CompanyProfile> = {
  generic: {
    orgName: "Demo Manufacturing Co., Pune",
    orgAddress: "Plot No. 12, Industrial Estate, Bhosari, Pune 411 026, Maharashtra",
    orgGstin: "27AABCD1234E1Z5",
    orgPhone: "+91 20 4000 1234",
    orgEmail: "info@demo-manufacturing.example",
    showOrgName: false,
    quotePrefix: "DMC/QT",
    ticketPrefix: "DMC/TK",
    leadPrefix: "DMC/EN",
    invInPrefix: "DMC/IN",
    invOutPrefix: "DMC/OUT",
    invAdjPrefix: "DMC/ADJ",
  },
  acdri: {
    orgName: "Auto Cluster Development and Research Institute (ACDRI)",
    orgAddress: "H-Block, Plot No. C-181, Chinchwad East, Mumbai Pune Road, Pune 411 019, Maharashtra",
    orgGstin: "27AAACA1234B1ZC",
    orgPhone: "+91 20 6633 3700",
    orgEmail: "customersupport@autoclusterpune.org",
    showOrgName: true,
    quotePrefix: "ACDRI/QT",
    ticketPrefix: "ACDRI/TK",
    leadPrefix: "ACDRI/EN",
    invInPrefix: "ACDRI/IN",
    invOutPrefix: "ACDRI/OUT",
    invAdjPrefix: "ACDRI/ADJ",
  },
};

/** DEMO_COMPANY from the environment; anything other than generic or acdri stops the script. */
export function demoCompany(value = process.env.DEMO_COMPANY): DemoCompany {
  const v = (value ?? "").trim().toLowerCase();
  if (v === "" || v === "generic") return "generic";
  if (v === "acdri") return "acdri";
  throw new Error(`DEMO_COMPANY must be "generic" or "acdri" (it is "${value}"). Nothing was changed.`);
}
