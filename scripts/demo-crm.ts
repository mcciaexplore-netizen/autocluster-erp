/**
 * CRM demo data (Module 4): team members and 12 fictional enquiries across every stage.
 * Used by db:seed / db:reset (with links to the demo customers and quotations) and by
 * crm:seed (enquiries only: it never touches customers, quotations or orders).
 * All companies and people are fictional.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { ensureCrmDefaults } from "../db/crm-defaults";
import type { DB, Tx } from "../db/client";
import { createLead, moveLead, type LeadInput } from "../db/lead-writer";
import * as s from "../db/schema";
import { addDays, todayInIndia } from "../lib/tickets";
import { toPaise } from "../lib/pricing";

export const DEMO_TEAM = [
  { name: "Priya Shah", phone: "9822100011", email: "priya.shah@staff.example" },
  { name: "Rohan Deshpande", phone: "9822100022", email: "rohan.deshpande@staff.example" },
  { name: "Amit Patil", phone: "9822100033", email: "amit.patil@staff.example" },
];

type Stage = "New" | "Contacted" | "Negotiation" | "Won" | "Lost";
type Act = { type: s.CrmActivityType; in: number; time?: string; note: string; who: string };

interface DemoLead {
  key: string;
  stage: Stage;
  source: string;
  priority: number;
  title: string;
  company: string;
  /** An existing demo customer (matched by the start of its name). */
  customer?: string;
  contact: string;
  designation?: string;
  phone?: string;
  email?: string;
  city: string;
  category?: "OEM" | "TIER1" | "TIER2" | "MSME";
  member?: boolean;
  depts: string[];
  services?: string[];
  value?: number; // rupees
  closeIn?: number; // days from today
  who: string;
  tags?: string[];
  createdDaysAgo: number;
  stageDaysAgo: number;
  notes?: string;
  activity?: Act;
  done?: { type: s.CrmActivityType; daysAgo: number; outcome: string };
  lostReason?: string;
  lostNote?: string;
}

/** 12 enquiries: New 3, Contacted 3, Negotiation 2, Won 2, Lost 2. */
const LEADS: DemoLead[] = [
  {
    key: "voltedge", stage: "New", source: "Website", priority: 1, title: "3D printed housings for EV charger prototype",
    company: "VoltEdge Mobility Pvt Ltd", contact: "Sneha Joshi", designation: "Product Engineer", phone: "9881234501", email: "sneha@voltedge.example",
    city: "Pune", category: "MSME", member: false, depts: ["RPT"], services: ["SLA - imported resin"], value: 60_000, closeIn: 25, who: "Priya Shah",
    tags: ["Startup"], createdDaysAgo: 2, stageDaysAgo: 2, notes: "Needs 6 housings in ABS-like resin. STEP files to be shared by email.",
    activity: { type: "CALL", in: 0, time: "11:30", note: "Confirm quantity and finish", who: "Priya Shah" },
  },
  {
    key: "bharat", stage: "New", source: "WhatsApp", priority: 0, title: "Salt spray test for zinc-plated brackets",
    company: "Bharat Fasteners", contact: "Amit Joshi", phone: "9890011122", city: "Chakan", category: "MSME",
    depts: ["ENV"], services: ["Mini salt spray chamber"], value: 18_000, who: "Amit Patil", createdDaysAgo: 1, stageDaysAgo: 1,
    notes: "Asked on WhatsApp for 96-hour neutral salt spray on 10 brackets.",
  },
  {
    key: "deccan", stage: "New", source: "MCCIA", priority: 2, title: "UTM and hardness tests for rubber bushes",
    company: "Deccan Polymers LLP", customer: "Deccan Polymers", contact: "Meera Iyer", phone: "9822056789", city: "Pune",
    depts: ["RPL"], services: ["UTM"], value: 25_000, closeIn: 30, who: "Amit Patil", tags: ["Repeat customer"], createdDaysAgo: 4, stageDaysAgo: 4,
    activity: { type: "EMAIL", in: 2, note: "Send test standards and sample size", who: "Amit Patil" },
  },
  {
    key: "lumax", stage: "Contacted", source: "Phone call", priority: 3, title: "Dust and water spray tests for headlamps",
    company: "Lumen Auto Lights Pvt Ltd", contact: "Sunil Rao", designation: "QA Manager", phone: "9890044455", email: "sunil.rao@lumenauto.example",
    city: "Bhosari", category: "TIER1", member: true, depts: ["ENV"], services: ["Dust spray chamber", "Water spray chamber"], value: 1_20_000, closeIn: 10,
    who: "Rohan Deshpande", tags: ["Urgent"], createdDaysAgo: 9, stageDaysAgo: 6, notes: "IP6K5 and IP6K9K for a new headlamp. Launch date is close.",
    activity: { type: "CALL", in: -2, time: "10:00", note: "Call back with chamber dates", who: "Rohan Deshpande" },
    done: { type: "CALL", daysAgo: 6, outcome: "Interested. Sending test plan and sample count" },
  },
  {
    key: "indus", stage: "Contacted", source: "Referral", priority: 1, title: "5-axis machining of turbine impellers",
    company: "Indus Forge Tier One Pvt Ltd", customer: "Indus Forge", contact: "Vikram Deshpande", phone: "9823012345", city: "Pune",
    depts: ["PPF"], services: ["5-axis machining"], value: 90_000, closeIn: 20, who: "Rohan Deshpande", createdDaysAgo: 12, stageDaysAgo: 5,
    activity: { type: "MEETING", in: 0, time: "15:00", note: "Review drawings with their tooling team", who: "Rohan Deshpande" },
  },
  {
    key: "shree", stage: "Contacted", source: "Walk-in", priority: 0, title: "FTIR material check for a failed seal",
    company: "Shree Rubber Works", contact: "Kiran More", phone: "9850077788", city: "Bhosari", category: "MSME", member: false,
    depts: ["RPL"], services: ["FTIR"], value: 7_500, who: "Amit Patil", createdDaysAgo: 7, stageDaysAgo: 3, notes: "Walked in with two failed seals. Wants a quick answer.",
  },
  {
    key: "western", stage: "Negotiation", source: "Email", priority: 2, title: "Thermal shock and UTM tests for mounts",
    company: "Western Drive Systems Ltd", customer: "Western Drive", contact: "Anil Kapoor", phone: "9822034567", city: "Pune",
    depts: ["ENV", "RPL"], services: ["Thermal shock chamber", "UTM"], value: 19_000, closeIn: 7, who: "Priya Shah", tags: ["Repeat customer"], createdDaysAgo: 8, stageDaysAgo: 5,
    activity: { type: "FOLLOW_UP", in: -5, note: "Ask if the quotation is approved", who: "Priya Shah" },
    done: { type: "MEETING", daysAgo: 6, outcome: "Agreed the test plan. Quotation to be sent" },
  },
  {
    key: "kalyani", stage: "Negotiation", source: "Exhibition / Event", priority: 3, title: "Prototype dashboard parts in SLA",
    company: "Kalyani Tooling Pvt Ltd", contact: "Neha Patil", designation: "Purchase Manager", phone: "9822012399", email: "neha@kalyanitooling.example",
    city: "Pune", category: "TIER2", member: true, depts: ["RPT"], services: ["SLA - imported resin", "Origin 1 SLA"], value: 2_40_000, closeIn: 15,
    who: "Amit Patil", tags: ["Urgent"], createdDaysAgo: 18, stageDaysAgo: 4, notes: "Met at our open house. 40 parts, 3 iterations expected.",
    activity: { type: "SITE_VISIT", in: 4, time: "11:00", note: "Visit their design centre with sample parts", who: "Amit Patil" },
  },
  {
    key: "sahyadri", stage: "Won", source: "Phone call", priority: 2, title: "5-axis finishing of mould inserts",
    company: "Sahyadri Auto Components Pvt Ltd", customer: "Sahyadri", contact: "Rohan Kulkarni", phone: "9822012345", city: "Pune",
    depts: ["PPF"], services: ["5-axis machining"], value: 7_200, who: "Rohan Deshpande", tags: ["Repeat customer"], createdDaysAgo: 75, stageDaysAgo: 3,
  },
  {
    key: "pune-moulds", stage: "Won", source: "Website", priority: 1, title: "Trial parts machined for a new mould",
    company: "Pune Precision Moulds Pvt Ltd", contact: "Farhan Shaikh", designation: "Director", phone: "9881100223", email: "farhan@punemoulds.example",
    city: "Pune", category: "MSME", member: true, depts: ["PPF"], services: ["3+1 axis machining"], value: 55_000, who: "Priya Shah",
    createdDaysAgo: 20, stageDaysAgo: 6, notes: "Converted to a customer after the trial order was confirmed.",
    activity: { type: "FOLLOW_UP", in: 7, note: "Check the trial parts and plan the next batch", who: "Priya Shah" },
  },
  {
    key: "orbit", stage: "Lost", source: "Other", priority: 1, title: "High-low chamber test for an ECU housing",
    company: "Orbit Electronics", contact: "Rahul Nair", email: "rahul@orbitelectronics.example", city: "Talegaon",
    depts: ["ENV"], services: ["High-low chamber"], value: 45_000, who: "Rohan Deshpande", createdDaysAgo: 25, stageDaysAgo: 10,
    lostReason: "Price too high", lostNote: "Went with a lab in Chakan at a lower rate.",
  },
  {
    key: "sunrise", stage: "Lost", source: "Exhibition / Event", priority: 0, title: "Xenon weathering for dashboard skins",
    company: "Sunrise Plastics", contact: "Pooja Kulkarni", phone: "9850011199", city: "Nashik",
    depts: ["RPL"], services: ["Xenon test chamber"], value: 30_000, who: "Amit Patil", tags: ["Government"], createdDaysAgo: 30, stageDaysAgo: 12,
    lostReason: "No response", lostNote: "Three calls and two emails, no reply.",
  },
];

/** The customer the "converted" demo enquiry became (only in the full demo). */
const CONVERTED_CUSTOMER = {
  companyName: "Pune Precision Moulds Pvt Ltd",
  category: "MSME" as const,
  udyamNo: "UDYAM-MH-26-0123456",
  addressLine1: "Plot 22, Sector 10, PCNTDA Bhosari",
  city: "Pune",
  state: "Maharashtra",
  stateCode: "27",
  pincode: "411026",
  gstRegistered: true,
  gstin: "27AAFCP4321K1Z9",
  pan: "AAFCP4321K",
  pocName: "Farhan Shaikh",
  pocDesignation: "Director",
  pocPhone: "9881100223",
  pocEmail: "farhan@punemoulds.example",
  isMcciaMember: true,
  mcciaMembershipId: "MCCIA/2022/0456",
  status: "ACTIVE" as const,
};

export interface CrmDemoOptions {
  /** Full demo: link enquiries to demo customers and quotations, and create the converted customer. */
  links: boolean;
  log?: (m: string) => void;
}

export async function loadCrmDemo(db: DB | Tx, opts: CrmDemoOptions) {
  const log = opts.log ?? (() => {});
  await ensureCrmDefaults(db);
  return db.transaction(async (tx) => {
    // Team members (reused if they already exist).
    const team = new Map<string, string>();
    for (const [i, m] of DEMO_TEAM.entries()) {
      const [found] = await tx.select().from(s.teamMembers).where(sql`lower(${s.teamMembers.name}) = lower(${m.name})`);
      const id = found?.id ?? (await tx.insert(s.teamMembers).values({ ...m, sortOrder: i + 1 }).returning())[0].id;
      team.set(m.name, id);
    }
    log(`  Team: ${DEMO_TEAM.map((m) => m.name).join(", ")}`);

    const stages = new Map((await tx.select().from(s.crmStages)).map((st) => [st.name, st]));
    const byName = <T extends { name: string; id: string }>(rows: T[], n: string) => rows.find((r) => r.name === n)?.id;
    const sources = await tx.select().from(s.crmSources);
    const reasons = await tx.select().from(s.crmLostReasons);
    const tags = await tx.select().from(s.crmTags);
    const svcs = await tx.select().from(s.services);
    const custs = await tx.select().from(s.customers).where(isNull(s.customers.deletedAt));
    const openStage = [...stages.values()].find((st) => st.type === "OPEN")!;
    const stageFor = (n: Stage) => stages.get(n) ?? [...stages.values()].find((st) => st.type === (n === "Won" ? "WON" : n === "Lost" ? "LOST" : "OPEN"))!;

    const today = todayInIndia();
    const at = (days: number) => new Date(Date.now() - days * 86_400_000);

    let converted: string | null = null;
    if (opts.links) {
      const [c] = await tx.insert(s.customers).values(CONVERTED_CUSTOMER).returning();
      await tx.insert(s.customerDepartments).values({ customerId: c.id, deptCode: "PPF" });
      const svc = svcs.find((x) => x.name === "3+1 axis machining");
      if (svc) await tx.insert(s.customerServices).values({ customerId: c.id, serviceId: svc.id });
      converted = c.id;
    }

    const made: Record<string, string> = {};
    for (const d of LEADS) {
      // Linking an enquiry to an existing customer only writes to the enquiry, so crm:seed does it too.
      const customer = d.customer ? custs.find((c) => c.companyName.startsWith(d.customer!)) : undefined;
      const final = stageFor(d.stage);
      const start = final.type === "LOST" ? openStage : final;
      const input: LeadInput = {
        title: d.title,
        sourceId: byName(sources, d.source) ?? byName(sources, "Other"),
        stageId: start.id,
        customerId: customer?.id ?? null,
        companyName: customer?.companyName ?? d.company,
        contactName: customer?.pocName ?? d.contact,
        designation: customer ? customer.pocDesignation : (d.designation ?? null),
        phone: customer?.pocPhone ?? d.phone ?? null,
        email: customer?.pocEmail ?? d.email ?? null,
        city: customer?.city ?? d.city,
        category: d.category ?? customer?.category ?? null,
        isMcciaMember: d.member ?? customer?.isMcciaMember ?? null,
        mcciaMembershipId: d.member ? "MCCIA/2023/0" + (100 + LEADS.indexOf(d)) : null,
        deptCodes: d.depts,
        serviceIds: (d.services ?? []).map((n) => svcs.find((x) => x.name === n)?.id).filter((x): x is number => x != null),
        expectedValuePaise: d.value != null ? d.value * 100 : null,
        expectedCloseDate: d.closeIn != null ? addDays(today, d.closeIn) : null,
        priority: d.priority,
        assignedTo: team.get(d.who) ?? null,
        tagIds: (d.tags ?? []).map((n) => byName(tags, n)).filter((x): x is string => !!x),
        notes: d.notes ?? null,
      };
      const lead = await createLead(tx, input, { createdAt: at(d.createdDaysAgo) });
      made[d.key] = lead.id;
      const event = (type: string, message: string, daysAgo: number) =>
        tx.insert(s.leadEvents).values({ leadId: lead.id, type, message, createdBy: "Demo User", createdAt: at(daysAgo) });

      if (d.stage !== "New" && start.type === "OPEN" && final.type === "OPEN" && d.stageDaysAgo < d.createdDaysAgo) {
        await event("STAGE", `Moved from ${openStage.name} to ${final.name}`, d.stageDaysAgo);
      }
      if (final.type === "LOST") {
        const reason = byName(reasons, d.lostReason ?? "Other");
        await moveLead(tx, lead.id, final.id, { lostReasonId: reason, lostNote: d.lostNote ?? null });
        await tx.update(s.leadEvents).set({ createdAt: at(d.stageDaysAgo) }).where(and(eq(s.leadEvents.leadId, lead.id), eq(s.leadEvents.type, "LOST")));
        await tx.update(s.leads).set({ lostAt: at(d.stageDaysAgo) }).where(eq(s.leads.id, lead.id));
      }
      if (final.type === "WON") await tx.update(s.leads).set({ wonAt: at(d.stageDaysAgo) }).where(eq(s.leads.id, lead.id));
      await tx.update(s.leads).set({ stageChangedAt: at(d.stageDaysAgo), updatedAt: at(Math.min(d.stageDaysAgo, d.createdDaysAgo)) }).where(eq(s.leads.id, lead.id));

      if (d.done) {
        await tx.insert(s.crmActivities).values({ leadId: lead.id, type: d.done.type, dueDate: addDays(today, -d.done.daysAgo), assignedTo: team.get(d.who), doneAt: at(d.done.daysAgo), outcome: d.done.outcome });
        await event("ACTIVITY_DONE", `${d.done.type === "CALL" ? "Call" : "Meeting"} done by Demo User: ${d.done.outcome}`, d.done.daysAgo);
      }
      if (d.activity) {
        const a = d.activity;
        await tx.insert(s.crmActivities).values({ leadId: lead.id, type: a.type, dueDate: addDays(today, a.in), dueTime: a.time ?? null, note: a.note, assignedTo: team.get(a.who) ?? null, createdAt: at(Math.max(0, d.stageDaysAgo)) });
      }
      log(`  ${lead.leadNo}  ${final.name.padEnd(11)} ${customer?.companyName ?? d.company}`);
    }

    if (opts.links) {
      // Negotiation enquiry -> the Western Drive quotation that is still Sent (accept it to see "Won").
      const western = custs.find((c) => c.companyName.startsWith("Western Drive"));
      const [sent] = western
        ? await tx.select().from(s.quotations).where(and(eq(s.quotations.customerId, western.id), eq(s.quotations.status, "SENT"), isNull(s.quotations.deletedAt))).limit(1)
        : [];
      if (sent) await linkQuote(tx, made.western, sent, "QUOTATION", 6);
      // Won enquiry -> Sahyadri's accepted quotation (the one already Paid on the Orders board).
      const sahyadri = custs.find((c) => c.companyName.startsWith("Sahyadri"));
      const [accepted] = sahyadri
        ? await tx.select().from(s.quotations).where(and(eq(s.quotations.customerId, sahyadri.id), eq(s.quotations.status, "ACCEPTED"), isNull(s.quotations.deletedAt))).limit(1)
        : [];
      if (accepted) {
        await linkQuote(tx, made.sahyadri, accepted, "QUOTATION", 70);
        await tx.insert(s.leadEvents).values({ leadId: made.sahyadri, type: "WON", message: `Marked as won: quotation ${accepted.quoteNo} was accepted`, createdBy: "Demo User", createdAt: at(3) });
      }
      // Won enquiry -> converted to a new customer.
      if (converted) {
        await tx.update(s.leads).set({ customerId: converted }).where(eq(s.leads.id, made["pune-moulds"]));
        await tx.insert(s.leadEvents).values({ leadId: made["pune-moulds"], type: "CONVERTED", message: `Converted to customer: ${CONVERTED_CUSTOMER.companyName}`, createdBy: "Demo User", createdAt: at(6) });
      }
    }
    return Object.keys(made).length;

    async function linkQuote(t: Tx, leadId: string, q: s.Quotation, type: string, daysAgo: number) {
      await t.update(s.quotations).set({ leadId }).where(eq(s.quotations.id, q.id));
      // The enquiry's expected value is the quotation amount before GST.
      const value = toPaise(q.taxableValue);
      await t.update(s.leads).set({ expectedValue: value }).where(eq(s.leads.id, leadId));
      await t.insert(s.leadEvents).values({ leadId, type, message: `Quotation ${q.quoteNo} created`, createdBy: "Demo User", createdAt: at(daysAgo) });
      log(`  linked ${q.quoteNo} (₹${(value / 100).toLocaleString("en-IN")} before GST)`);
    }
  });
}
