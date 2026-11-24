/**
 * The demo data, shared by `npm run db:seed` and `npm run db:reset`.
 * Kept free of Next.js imports so it runs as a plain script.
 */
import { sql } from "drizzle-orm";
import { config } from "dotenv";
import { createDb, createPool, type DB, type Tx } from "../db/client";
import * as s from "../db/schema";
import { createQuotation } from "../db/quote-writer";
import { ensureCrmDefaults } from "../db/crm-defaults";
import { ensureInventoryDefaults } from "../db/inv-defaults";
import { assignInventoryDoneBy, loadInventoryDemo } from "./demo-inventory";
import { loadCrmDemo } from "./demo-crm";
import { DEFAULT_TERMS } from "../lib/settings-shared";
import { loadDemoOrders, type DemoOrdersOptions } from "./demo-orders";
import { loadPlanningDemo } from "./demo-planning";
import { ensureDefaultRoles } from "../db/role-writer";
import { ensureAppUsersForTeam } from "../db/user-writer";

// Local development: read .env.local. When a database is passed in another way (e.g. --env-file for
// Preview or live), don't mix in .env.local: its DEMO_MODE must not apply to another database.
if (!process.env.DATABASE_URL && !process.env.DATABASE_URL_UNPOOLED) config({ path: ".env.local", quiet: true });

/** Scripts use the DIRECT (unpooled) connection, falling back to DATABASE_URL for local Postgres. */
export function scriptDb() {
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) {
    console.error("Set DATABASE_URL_UNPOOLED (or DATABASE_URL) in .env.local first.");
    process.exit(1);
  }
  const pool = createPool(url, 2);
  let where = "the database";
  try {
    const u = new URL(url);
    where = u.hostname === "localhost" || u.hostname === "127.0.0.1" ? "your LOCAL database" : `the database at ${u.hostname.split(".").slice(-3).join(".")}`;
  } catch {}
  return { db: createDb(pool), pool, where };
}

export async function isEmpty(db: DB | Tx) {
  const counts = await db.execute<{ n: number }>(sql`
    select (select count(*) from customers) + (select count(*) from quotations)
         + (select count(*) from departments) + (select count(*) from settings) as n`);
  return Number(counts.rows[0].n) === 0;
}

export async function wipe(db: DB | Tx) {
  await db.execute(
    sql`TRUNCATE activity_log, sign_in_attempts, shared_devices, user_roles, user_departments, role_permissions, roles, app_users, auth_sessions, auth_accounts, auth_verifications, auth_users, job_time_logs, job_events, job_files, job_bookings, jobs, machine_blocks, machine_services, machines, holidays, inv_reorder_sends, inv_count_lines, inv_counts, inv_service_materials, inv_movements, inv_documents, inv_batches, inv_supplier_items, inv_item_departments, inv_items, inv_suppliers, inv_counters, inv_categories, inv_units, inv_purposes, inv_adjust_reasons, lead_events, crm_activities, lead_tags, lead_services, lead_departments, leads, lead_counters, crm_stage_changes, crm_stages, crm_sources, crm_lost_reasons, crm_tags, team_members, ticket_events, follow_ups, payments, tickets, invoices, purchase_orders, billing_exports, files, ticket_counters, quotation_items, quotations, quote_counters, customer_services, customer_departments, customers, services, departments, settings RESTART IDENTITY CASCADE`,
  );
}

type UnitType = "PER_CC" | "PER_HOUR" | "PER_SAMPLE" | "PER_HOUR_3_SAMPLES";

const DEPARTMENTS = [
  { code: "RPT", name: "Rapid Prototyping", description: "3D printing (SLA, SLS, Figure 4, Origin 1), charged per cc", sortOrder: 1 },
  { code: "PPF", name: "Prototype Production Facility", description: "CNC machining (5-axis, 3+1 axis), charged per hour", sortOrder: 2 },
  { code: "ENV", name: "Environmental Testing", description: "Thermal shock, water spray, dust, high-low, salt spray chambers", sortOrder: 3 },
  { code: "RPL", name: "Rubber & Polymer Lab", description: "UTM, FTIR, DSC, melt flow, ozone, oven, xenon, QUV", sortOrder: 4 },
  { code: "MET", name: "Metrology & CMM", description: "Large-bed measurement of dies, auto and mechanical parts", sortOrder: 5 },
];

const UNIT_LABEL: Record<UnitType, string> = {
  PER_CC: "per cc",
  PER_HOUR: "per hour",
  PER_SAMPLE: "per sample",
  PER_HOUR_3_SAMPLES: "per hour (up to 3 samples)",
};

const SERVICES: [string, string, UnitType, number, number][] = [
  ["RPT", "SLA - imported resin", "PER_CC", 40, 80],
  ["RPT", "SLA - local resin", "PER_CC", 25, 40],
  ["RPT", "Figure 4 Standalone Pro, black", "PER_CC", 70, 100],
  ["RPT", "SLS", "PER_CC", 30, 40],
  ["RPT", "Origin 1 SLA", "PER_CC", 55, 75],
  ["PPF", "5-axis machining", "PER_HOUR", 1800, 2000],
  ["PPF", "3+1 axis machining", "PER_HOUR", 300, 400],
  ["ENV", "Thermal shock chamber", "PER_HOUR", 190, 220],
  ["ENV", "Water spray chamber", "PER_HOUR", 400, 500],
  ["ENV", "Dust spray chamber", "PER_HOUR", 450, 550],
  ["ENV", "High-low chamber", "PER_HOUR", 275, 320],
  ["ENV", "Mini salt spray chamber", "PER_HOUR", 40, 50],
  ["RPL", "UTM", "PER_SAMPLE", 1800, 2100],
  ["RPL", "Ozone chamber", "PER_HOUR", 200, 250],
  ["RPL", "Hot air oven", "PER_HOUR", 60, 80],
  ["RPL", "FTIR", "PER_SAMPLE", 2500, 3000],
  ["RPL", "Xenon test chamber", "PER_HOUR_3_SAMPLES", 80, 120],
  ["RPL", "Melt flow index", "PER_SAMPLE", 1500, 1800],
  ["RPL", "QUV Weather-Ometer", "PER_HOUR_3_SAMPLES", 80, 100],
  ["RPL", "DSC", "PER_SAMPLE", 2700, 3200],
];

/** Rate Card "Time needed" (setup minutes, minutes per unit), used to suggest job hours. Origin 1 SLA is left unset on purpose. */
const TIME_NEEDED: Record<string, [number, number]> = {
  "SLA - imported resin": [45, 0.6],
  "SLA - local resin": [45, 0.6],
  "Figure 4 Standalone Pro, black": [20, 0.4],
  SLS: [90, 0.5],
  UTM: [15, 20],
  FTIR: [10, 15],
  "Melt flow index": [20, 30],
  DSC: [15, 45],
};

/** Chamber tests that use no stock: Rate Card "No materials needed". */
const NO_MATERIALS = new Set(["Thermal shock chamber", "Water spray chamber", "High-low chamber", "Ozone chamber", "Hot air oven"]);

// Fictional companies. GST / PAN / TAN numbers are valid in format only.
const CUSTOMERS = [
  {
    companyName: "Sahyadri Auto Components Pvt Ltd",
    category: "MSME" as const,
    udyamNo: "UDYAM-MH-26-0012345",
    addressLine1: "Plot 42, MIDC Bhosari",
    addressLine2: "Near Landewadi Chowk",
    city: "Pune", state: "Maharashtra", stateCode: "27", pincode: "411026",
    gstin: "27AAKCS1234F1Z5", pan: "AAKCS1234F", tan: "PNES12345A",
    pocName: "Rohan Kulkarni", pocDesignation: "Purchase Manager", pocPhone: "9822012345", pocEmail: "rohan.k@sahyadri-auto.example",
    isMcciaMember: true, mcciaMembershipId: "MCCIA/2019/04512", creditDays: 45,
    depts: ["RPT", "PPF"],
    services: ["SLA - imported resin", "SLA - local resin", "5-axis machining"],
  },
  {
    companyName: "Deccan Polymers LLP",
    category: "MSME" as const,
    udyamNo: "UDYAM-MH-26-0045678",
    addressLine1: "Gat No. 118, Chakan Industrial Area",
    addressLine2: null,
    city: "Pune", state: "Maharashtra", stateCode: "27", pincode: "410501",
    gstin: "27AAJFD5678K1ZQ", pan: "AAJFD5678K", tan: null,
    pocName: "Sneha Joshi", pocDesignation: "Quality Head", pocPhone: "9890123456", pocEmail: "sneha@deccanpolymers.example",
    isMcciaMember: false, mcciaMembershipId: null,
    depts: ["RPL"],
    services: ["Xenon test chamber", "Melt flow index", "DSC"],
  },
  {
    companyName: "Western Drive Systems Ltd",
    category: "OEM" as const,
    udyamNo: null,
    addressLine1: "Survey No. 7, Hinjewadi Phase 2",
    addressLine2: "Rajiv Gandhi Infotech Park",
    city: "Pune", state: "Maharashtra", stateCode: "27", pincode: "411057",
    gstin: "27AABCW4321M1Z2", pan: "AABCW4321M", tan: "PNEW54321B",
    pocName: "Amit Deshpande", pocDesignation: "Validation Lead", pocPhone: "9765432109", pocEmail: "amit.deshpande@westerndrive.example",
    isMcciaMember: true, mcciaMembershipId: "MCCIA/2011/00877",
    depts: ["ENV", "RPL"],
    services: ["Thermal shock chamber", "Water spray chamber", "UTM", "FTIR"],
  },
  {
    companyName: "Indus Forge Tier One Pvt Ltd",
    category: "TIER1" as const,
    udyamNo: null,
    addressLine1: "No. 23, Peenya Industrial Area, Phase 1",
    addressLine2: null,
    city: "Bengaluru", state: "Karnataka", stateCode: "29", pincode: "560058",
    gstin: "29AADCI8765R1ZK", pan: "AADCI8765R", tan: "BLRI87654C",
    pocName: "Kavya Rao", pocDesignation: "Engineering Manager", pocPhone: "9845098450", pocEmail: "kavya.rao@indusforge.example",
    isMcciaMember: false, mcciaMembershipId: null,
    depts: ["PPF"],
    services: ["5-axis machining", "3+1 axis machining"],
  },
  {
    companyName: "Nashik Precision Tools",
    category: "MSME" as const,
    udyamNo: "UDYAM-MH-21-0098765",
    addressLine1: "B-17, Ambad MIDC",
    addressLine2: null,
    city: "Nashik", state: "Maharashtra", stateCode: "27", pincode: "422010",
    gstin: "27ABPFN2468L1Z9", pan: "ABPFN2468L", tan: null,
    pocName: "Vikram Patil", pocDesignation: "Proprietor", pocPhone: "9423012345", pocEmail: "vikram@nashikprecision.example",
    isMcciaMember: true, mcciaMembershipId: "MCCIA/2022/07731",
    depts: ["RPT"],
    services: ["SLS", "Origin 1 SLA"],
  },
  {
    companyName: "Kaveri Mobility Parts Pvt Ltd",
    category: "TIER2" as const,
    udyamNo: null,
    addressLine1: "Plot 9, SIPCOT Industrial Park",
    addressLine2: "Irungattukottai",
    city: "Chennai", state: "Tamil Nadu", stateCode: "33", pincode: "602117",
    gstin: "33AAECK1357P1ZX", pan: "AAECK1357P", tan: "CHEK13579D",
    pocName: "Arun Subramanian", pocDesignation: "Testing Coordinator", pocPhone: "9884012345", pocEmail: "arun.s@kaverimobility.example",
    isMcciaMember: true, mcciaMembershipId: "MCCIA/2020/05120",
    depts: ["ENV"],
    services: ["Dust spray chamber", "High-low chamber", "Mini salt spray chamber"],
  },
];

/** `orders` also adds the Orders & Billing demo (tickets, POs, invoices, payments, sample PDFs). */
export async function loadDemoData(db: DB | Tx, opts: { quiet?: boolean; orders?: DemoOrdersOptions; crm?: boolean; inventory?: boolean; planning?: boolean; now?: Date } = {}) {
  const console = opts.quiet ? { log: () => {} } : globalThis.console;
  console.log("Adding settings, departments and the rate card...");
  await db.insert(s.settings).values({
    id: 1,
    orgName: "AutoCluster",
    orgAddress: "Automotive Cluster Development & Research Institute, H-Block, Plot No. 1, MIDC Pimpri, Pune 411018, Maharashtra",
    orgGstin: "27AAACA1234B1ZC",
    orgPhone: "020 2712 0000",
    orgEmail: "info@autocluster.example",
    memberDiscountPct: "10",
    applyDiscountToNonMsme: true,
    gstPct: "18",
    homeStateCode: "27",
    quoteValidityDays: 30,
    quotePrefix: "ACDRI/QT",
    defaultTerms: DEFAULT_TERMS,
  });
  await ensureCrmDefaults(db);
  await ensureInventoryDefaults(db);
  await db.insert(s.departments).values(DEPARTMENTS);
  const svcRows = await db
    .insert(s.services)
    .values(
      SERVICES.map(([deptCode, name, unitType, msme, oem], i) => ({
        deptCode,
        name,
        unitType,
        unitLabel: UNIT_LABEL[unitType],
        rateMsme: msme.toFixed(2),
        rateOem: oem.toFixed(2),
        effectiveFrom: "2025-11-01",
        sortOrder: i + 1,
        setupMinutes: TIME_NEEDED[name]?.[0] ?? null,
        minutesPerUnit: TIME_NEEDED[name] ? String(TIME_NEEDED[name][1]) : null,
        noMaterialsNeeded: NO_MATERIALS.has(name),
      })),
    )
    .returning();
  const svcByName = new Map(svcRows.map((r) => [r.name, r]));

  console.log("Adding 6 demo customers...");
  const custIds: Record<string, string> = {};
  for (const c of CUSTOMERS) {
    const { depts, services: svcNames, ...data } = c;
    const [row] = await db.insert(s.customers).values({ ...data, gstRegistered: true, status: "ACTIVE" }).returning();
    custIds[c.companyName] = row.id;
    await db.insert(s.customerDepartments).values(depts.map((deptCode) => ({ customerId: row.id, deptCode })));
    await db.insert(s.customerServices).values(svcNames.map((n) => ({ customerId: row.id, serviceId: svcByName.get(n)!.id })));
  }

  if (opts.inventory) {
    // Before the story quotations, so those keep the last numbers.
    console.log("Adding the Inventory demo (suppliers, items, 6 months of jobs and stock records)...");
    await loadInventoryDemo(db, custIds, { blobFolder: opts.orders?.blobFolder ?? "local", log: (m) => console.log(m) });
  }

  console.log("Adding 3 sample quotations...");
  const today = new Date();
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const daysAgo = (n: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - n);
  const plus30 = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 30);
  const line = (name: string, q: Partial<{ ccPerPart: number; parts: number; hours: number; samples: number }>, notes?: string) => {
    const svc = svcByName.get(name)!;
    return {
      key: crypto.randomUUID(),
      serviceId: svc.id,
      deptCode: svc.deptCode,
      description: svc.name,
      unitType: svc.unitType,
      unitLabel: svc.unitLabel,
      customRatePaise: null,
      notes: notes ?? null,
      ...q,
    };
  };

  const samples = [
    {
      customer: "Sahyadri Auto Components Pvt Ltd",
      date: daysAgo(12),
      // Sent, not Accepted: marking it Accepted is the first step of the demo (a ₹8,496 ticket appears).
      status: "SENT" as const,
      subject: "Quotation for Rapid Prototyping services",
      lines: [line("SLA - imported resin", { ccPerPart: 50, parts: 4 }, "Housing cover prototype")],
    },
    {
      customer: "Western Drive Systems Ltd",
      date: daysAgo(5),
      status: "SENT" as const,
      subject: "Quotation for Environmental Testing and Rubber & Polymer Lab services",
      lines: [
        line("Thermal shock chamber", { hours: 48 }, "As per IEC 60068-2-14"),
        line("UTM", { samples: 5 }, "Tensile test, ASTM D412"),
      ],
    },
    {
      customer: "Indus Forge Tier One Pvt Ltd",
      date: daysAgo(1),
      status: "DRAFT" as const,
      subject: "Quotation for Prototype Production Facility services",
      lines: [line("5-axis machining", { hours: 6 }, "Impeller trial batch")],
    },
  ];

  for (const q of samples) {
    const r = await createQuotation(db, {
      customerId: custIds[q.customer],
      quoteDate: iso(q.date),
      validUntil: iso(plus30(q.date)),
      subject: q.subject,
      notes: null,
      terms: DEFAULT_TERMS,
      status: q.status,
      lines: q.lines,
    });
    console.log(`  ${r.quoteNo}  ${q.customer}  (${q.status})`);
  }

  if (opts.orders) {
    console.log(`Adding Orders & Billing demo (sample PDFs go to the "${opts.orders.blobFolder}/" folder)...`);
    await loadDemoOrders(db, custIds, { ...opts.orders, log: (m) => console.log(m) });
  }

  if (opts.crm) {
    console.log("Adding the CRM demo (team members and 12 enquiries)...");
    await loadCrmDemo(db, { links: true, log: (m) => console.log(m) });
  }
  if (opts.inventory && opts.crm) await assignInventoryDoneBy(db);

  // Module 7: every team member is also a user (name only until an admin lets them sign in), and the default roles exist.
  await ensureAppUsersForTeam(db);
  await ensureDefaultRoles(db);

  if (opts.planning) {
    console.log("Adding the Planning demo (33 machines, holidays, 8 weeks of jobs and the next 2 weeks)...");
    return loadPlanningDemo(db, { log: (m) => console.log(m), now: opts.now, blobFolder: opts.orders?.blobFolder ?? "local" });
  }

}
