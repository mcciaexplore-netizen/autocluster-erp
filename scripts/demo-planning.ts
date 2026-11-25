/**
 * The Planning demo (brief section 13): ACDRI's 33 machines, holidays, and 8 weeks of jobs with
 * bookings and time logs, plus the next 2 weeks. Runs last, after the other demos, and turns the
 * jobs their tickets created into a believable history. Uses a fixed random seed.
 *
 * Story it sets up:
 *   5-Axis VMC 90%+ booked for the next 2 weeks; Ozone Test Chamber rarely used;
 *   Water Spray chamber under maintenance next week; SLA 7000 HD broke down last month;
 *   jobs to plan (one urgent, one past its promised date); one running now; one on hold
 *   "Waiting for customer drawings"; one late job; a tentative hold expiring tomorrow and one
 *   already expired; three past per-hour jobs over 10% longer than quoted; custom-item jobs on
 *   the laser and the CMM.
 */
import { stageDemoFile } from "./demo-files";
import { eq, inArray, sql } from "drizzle-orm";
import type { DB, Tx } from "../db/client";
import { bookTime } from "../db/booking-writer";
import { addInvoice } from "../db/invoice-writer";
import { recordPayment } from "../db/payment-writer";
import { addPurchaseOrder, registerFile } from "../db/po-writer";
import { createQuotation } from "../db/quote-writer";
import * as s from "../db/schema";
import { changeQuotationStatus } from "../db/ticket-writer";
import { addWorkingHours, dayPlus, istAt, istDate, maxAtOnce, nextWorkingMoment, overlaps, patternFromSettings, segmentsOn, snapTo30, type Span, type WorkPattern } from "../lib/planning/hours";
import { machineUse, weekStart } from "../lib/planning/use";
import type { BlobEnv } from "../lib/files";
import { formatDate } from "../lib/format";
import { financialYear, paiseToRupeeString, toPaise } from "../lib/pricing";
import { DEFAULT_TERMS } from "../lib/settings-shared";
import { samplePdf } from "./demo-orders";

type M = { dept: string; name: string; make?: string; specs?: string; standards?: string; services?: string[]; parallel?: number; nonstop?: boolean; nabl?: boolean; notes?: string };

/** ACDRI's machines, from the equipment catalogue (plus 3 that are only on the rate card). */
export const DEMO_MACHINES: M[] = [
  { dept: "PPF", name: "5-Axis VMC (Non-Continuous)", make: "Rambaudi", specs: "Large-envelope 5-axis: 2D/3D profiles, boring, drilling, reaming, side-face work", services: ["5-axis machining"] },
  { dept: "PPF", name: "3-Axis VMC", make: "Hartford", specs: "16-tool automatic tool changer: profiling, boring, drilling, reaming" },
  { dept: "PPF", name: "5+1 Axis Laser (Rotary Attachment)", make: "TRUMPF", specs: "5-axis laser cutting with rotary attachment and welding head. Oxygen cutting up to 12 mm, nitrogen up to 8 mm" },
  { dept: "PPF", name: "3+1 Axis VMC (Rotary Attachment)", make: "TAI", specs: "Rotary attachment, 20-tool automatic tool changer", services: ["3+1 axis machining"] },
  { dept: "PPF", name: "Turn Mill Centre", make: "ACE", specs: "Turning and milling in one setup, 12-station turret" },
  { dept: "PPF", name: "Deep Hole Drilling", make: "Ixion", specs: "Single stroke to 650 mm depth at 20 mm diameter" },
  { dept: "PPF", name: "Die Sinking EDM", specs: "Specs pending" },
  { dept: "PPF", name: "W-EDM", specs: "Submerged-type CNC wire EDM, specs pending" },
  { dept: "RPT", name: "SLA - 3D Systems 7000 HD", make: "3D Systems ProX 7000 HD", specs: "High-detail parts and investment casting patterns", services: ["SLA - imported resin", "SLA - local resin"] },
  { dept: "RPT", name: "SLS - EOS P385", make: "EOS P385", specs: "Polyamide functional parts, medical and architectural models", services: ["SLS"] },
  { dept: "RPT", name: "FDM - Stratasys 450 MC", make: "Stratasys Fortus 450mc", specs: "Production-grade ABS and ASA" },
  { dept: "RPT", name: "Vacuum Casting - KLM", make: "KLM", specs: "Silicone-tool short runs, flexible and rigid parts" },
  { dept: "RPT", name: "Figure 4 Standalone Pro", services: ["Figure 4 Standalone Pro, black"], notes: "On the rate card; not in the equipment catalogue." },
  { dept: "RPT", name: "Origin 1 SLA", services: ["Origin 1 SLA"], notes: "On the rate card; not in the equipment catalogue." },
  { dept: "ENV", name: "Xenon Test Chamber", services: ["Xenon test chamber"], nonstop: true, nabl: true, notes: "Priced under RPL on the rate card." },
  { dept: "ENV", name: "Salt Spray Test Chamber", services: ["Mini salt spray chamber"], parallel: 2, nonstop: true, nabl: true },
  { dept: "ENV", name: "Dust Spray Test Chamber", services: ["Dust spray chamber"], nonstop: true, nabl: true },
  { dept: "ENV", name: "Water Spray Test Chamber", services: ["Water spray chamber"], nonstop: true, nabl: true },
  { dept: "ENV", name: "Thermal Shock Test Chamber", services: ["Thermal shock chamber"], nonstop: true, nabl: true },
  { dept: "ENV", name: "High-Low Temperature Chamber", services: ["High-low chamber"], nonstop: true, nabl: true },
  { dept: "RPL", name: "Universal Testing Machine (UTM)", make: "Tinius Olsen", standards: "ASTM D638, ASTM D412, ISO 178", services: ["UTM"], nabl: true },
  { dept: "RPL", name: "Thermogravimetric Analyser (TGA)", make: "Shimadzu", nabl: true },
  { dept: "RPL", name: "Instron Actuator (fatigue)", make: "Instron", nonstop: true, nabl: true },
  { dept: "RPL", name: "Ozone Test Chamber", make: "In 2000 - L2 (low concentration)", standards: "ASTM D1171, ASTM D1149", services: ["Ozone chamber"], nonstop: true, nabl: true },
  { dept: "RPL", name: "Impact Tester", make: "CEAST S.p.A. Resil Impactor", standards: "ISO 180, ISO 179", nabl: true },
  { dept: "RPL", name: "Accelerated Weathering Tester (QUV/Spray)", make: "Q-Lab", services: ["QUV Weather-Ometer"], nonstop: true, nabl: true },
  { dept: "RPL", name: "Melt Flow Indexer", make: "Tinius Olsen MP 600", standards: "ASTM D1238, ISO 1133", services: ["Melt flow index"], nabl: true },
  { dept: "RPL", name: "Differential Scanning Calorimeter (DSC)", make: "Shimadzu DSC 60", standards: "ASTM E928, ASTM D1525, ASTM D648", services: ["DSC"], nabl: true },
  { dept: "RPL", name: "HDT & VICAT Softening Temperature Tester", make: "CEAST S.p.A. HDT 3", standards: "ASTM D648, ASTM D1525", parallel: 3, nabl: true, notes: "3 stations: one job per station." },
  { dept: "RPL", name: "Multi Head Micro Hardness Tester", make: "Gibitre", standards: "ISO 48, ISO 868, BS 903", nabl: true },
  { dept: "RPL", name: "FTIR Spectrometer", make: "Thermo Electron Nicolet 380", standards: "ASTM E1252", services: ["FTIR"], nabl: true },
  { dept: "RPL", name: "Hot Air Oven", services: ["Hot air oven"], nonstop: true, nabl: true, notes: "On the rate card; not in the equipment catalogue." },
  { dept: "MET", name: "Co-ordinate Measuring Machine (CMM)", make: "Accurate Cordimesur", specs: "Large-bed measurement of dies, auto and mechanical parts, prototypes" },
];

/** Fixed-date public holidays (Maharashtra), for this year and next. */
const HOLIDAYS: [string, string][] = [
  ["01-26", "Republic Day"],
  ["02-19", "Chhatrapati Shivaji Maharaj Jayanti"],
  ["05-01", "Maharashtra Day"],
  ["08-15", "Independence Day"],
  ["10-02", "Gandhi Jayanti"],
  ["12-25", "Christmas"],
];

/** Small fixed-seed random numbers (mulberry32), so every reset gives the same story. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Demo operators' daily work (3 weeks ahead): their departments, machines (never the 5-Axis VMC) and kinds of work. */
const OP_DEPTS: Record<string, string[]> = { "Amit Patil": ["PPF", "MET"], "Rohan Deshpande": ["RPT"], "Priya Shah": ["ENV", "RPL"] };
const OP_MACHINES: Record<string, string[]> = {
  PPF: ["3-Axis VMC", "Turn Mill Centre", "Deep Hole Drilling", "3+1 Axis VMC (Rotary Attachment)", "W-EDM", "Die Sinking EDM"],
  MET: ["Co-ordinate Measuring Machine (CMM)"],
  RPT: ["FDM - Stratasys 450 MC", "Figure 4 Standalone Pro", "Origin 1 SLA", "SLS - EOS P385", "Vacuum Casting - KLM"],
  ENV: ["Salt Spray Test Chamber", "Water Spray Test Chamber", "Thermal Shock Test Chamber", "Xenon Test Chamber"],
  RPL: ["Universal Testing Machine (UTM)", "Impact Tester", "Thermogravimetric Analyser (TGA)", "Melt Flow Indexer", "Multi Head Micro Hardness Tester"],
};
const OP_WORK: Record<string, { what: string; hours: number; rate: number }[]> = {
  PPF: [
    { what: "3-axis milling of fixture blocks (customer tooling)", hours: 3, rate: 2700_00 },
    { what: "Turn-mill machining of EN8 pins (customer bar stock)", hours: 2.5, rate: 3000_00 },
    { what: "Deep hole drilling of cooling lines (customer insert)", hours: 2, rate: 2000_00 },
  ],
  MET: [{ what: "CMM first article inspection", hours: 2, rate: 2600_00 }],
  RPT: [
    { what: "FDM assembly jigs in customer-supplied ABS", hours: 3, rate: 2400_00 },
    { what: "Resin prints in customer-supplied resin", hours: 2.5, rate: 2200_00 },
    { what: "SLS parts in customer-supplied PA12 powder", hours: 3, rate: 3600_00 },
  ],
  ENV: [
    { what: "Salt spray check (customer profile, 6 h)", hours: 6, rate: 1800_00 },
    { what: "Water spray IPX4 check", hours: 4, rate: 1600_00 },
  ],
  RPL: [
    { what: "Tensile test batch (customer specimens)", hours: 2, rate: 3000_00 },
    { what: "Izod impact batch (customer specimens)", hours: 2, rate: 2400_00 },
    { what: "Micro hardness survey (customer samples)", hours: 2, rate: 2000_00 },
  ],
};

const OPERATOR_FOR: Record<string, string> = { PPF: "Amit Patil", MET: "Amit Patil", RPT: "Rohan Deshpande", ENV: "Priya Shah", RPL: "Priya Shah" };
const HOUR = 3_600_000;
const daysBetweenDates = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Time logs for work that ran `hours` from `start`: split at day ends and the break for shift machines. */
function logSpans(start: Date, hours: number, p: WorkPattern, nonstop: boolean): Span[] {
  if (nonstop) return [{ start, end: new Date(start.getTime() + hours * HOUR) }];
  const out: Span[] = [];
  let left = hours * 60;
  let date = istDate(start);
  for (let guard = 0; left > 0.01 && guard < 400; guard++, date = dayPlus(date, 1)) {
    for (const [a, b] of segmentsOn(date, p)) {
      const segStart = new Date(Math.max(istAt(date, a).getTime(), start.getTime()));
      const segEnd = istAt(date, b);
      if (segEnd <= segStart) continue;
      const take = Math.min(left, (segEnd.getTime() - segStart.getTime()) / 60_000);
      out.push({ start: segStart, end: new Date(segStart.getTime() + take * 60_000) });
      left -= take;
      if (left <= 0.01) break;
    }
  }
  return out;
}

export async function loadPlanningDemo(conn: DB | Tx, opts: { log?: (m: string) => void; now?: Date; blobFolder?: BlobEnv } = {}) {
  const db = conn as DB; // the writers open their own (nested) transactions
  const log = opts.log ?? (() => {});
  const now = opts.now ?? new Date();
  const today = istDate(now);
  const day = (n: number) => dayPlus(today, n);
  const rnd = seeded(20261121);

  // ---- Organisation profile, holidays --------------------------------------------------------
  await db
    .update(s.settings)
    .set({
      orgName: "Auto Cluster Development and Research Institute (ACDRI)",
      orgAddress: "H-Block, Plot No. C-181, Chinchwad East, Mumbai Pune Road, Pune 411 019, Maharashtra",
      orgPhone: "+91 20 6633 3700",
      orgEmail: "customersupport@autoclusterpune.org",
    })
    .where(eq(s.settings.id, 1));
  const year = Number(today.slice(0, 4));
  const holidayRows = [year, year + 1].flatMap((y) => HOLIDAYS.map(([md, name]) => ({ date: `${y}-${md}`, name }))).filter((h) => h.date >= day(-70));
  await db.insert(s.holidays).values(holidayRows);
  log(`  Organisation profile set to ACDRI; ${holidayRows.length} holidays`);

  const [set] = await db.select().from(s.settings).where(eq(s.settings.id, 1));
  const pattern = patternFromSettings(set, holidayRows.map((h) => h.date));

  // ---- Machines -------------------------------------------------------------------------------
  const svcRows = await db.select().from(s.services);
  const svcId = (n: string) => svcRows.find((x) => x.name === n)!.id;
  const machineRows = await db
    .insert(s.machines)
    .values(
      DEMO_MACHINES.map((m, i) => ({
        code: `MC-${String(i + 1).padStart(2, "0")}`,
        name: m.name,
        deptCode: m.dept,
        makeModel: m.make ?? null,
        keySpecs: m.specs ?? null,
        testStandards: m.standards ?? null,
        nablAccredited: m.nabl ?? false,
        parallelJobs: m.parallel ?? 1,
        runsNonstop: m.nonstop ?? false,
        notes: m.notes ?? null,
        sortOrder: i + 1,
      })),
    )
    .returning();
  const machine = (name: string) => machineRows.find((m) => m.name === name)!;
  const links = DEMO_MACHINES.flatMap((m) => (m.services ?? []).map((n) => ({ machineId: machine(m.name).id, serviceId: svcId(n) })));
  await db.insert(s.machineServices).values(links);
  const machineForService = new Map(links.map((l) => [l.serviceId, machineRows.find((m) => m.id === l.machineId)!]));
  log(`  ${machineRows.length} machines in 5 departments, ${links.length} rate card links`);

  // ---- Blocked time ---------------------------------------------------------------------------
  const nextMonday = dayPlus(weekStart(today), 7);
  const blocks = [
    { machineId: machine("SLA - 3D Systems 7000 HD").id, type: "BREAKDOWN" as const, startAt: istAt(day(-18), 10 * 60), endAt: istAt(day(-16), 17 * 60), note: "Laser power dropped mid-build. Service engineer replaced the scanner mirror." },
    { machineId: machine("Water Spray Test Chamber").id, type: "MAINTENANCE" as const, startAt: istAt(dayPlus(nextMonday, 1), 9 * 60), endAt: istAt(dayPlus(nextMonday, 2), 18 * 60), note: "Half-yearly maintenance by the supplier" },
    { machineId: machine("Differential Scanning Calorimeter (DSC)").id, type: "CALIBRATION" as const, startAt: istAt(day(-12), 9 * 60), endAt: istAt(day(-12), 13 * 60), note: "Yearly calibration with indium standard" },
    { machineId: machine("Universal Testing Machine (UTM)").id, type: "CALIBRATION" as const, startAt: istAt(day(-33), 9 * 60), endAt: istAt(day(-33), 18 * 60), note: "Load cell calibration (NABL)" },
  ];
  await db.insert(s.machineBlocks).values(blocks.map((b) => ({ ...b, createdBy: "Demo User", createdAt: new Date(Math.min(b.startAt.getTime(), now.getTime())) })));

  // ---- Team -----------------------------------------------------------------------------------
  const team = await db.select().from(s.teamMembers);
  const operatorFor = (dept: string | null) => team.find((t) => t.name === OPERATOR_FOR[dept ?? ""])?.id ?? team[0]?.id ?? null;
  const operatorName = (id: string | null) => team.find((t) => t.id === id)?.name ?? null;

  // ---- Story quotations (go through the real writers) -----------------------------------------
  const customers = await db.select({ id: s.customers.id, name: s.customers.companyName }).from(s.customers);
  const cust = (n: string) => customers.find((c) => c.name === n)!.id;
  type Q = Partial<{ ccPerPart: number; parts: number; hours: number; samples: number; quantity: number }>;
  type L = { name?: string; custom?: { dept: string; description: string; unitLabel: string; ratePaise: number }; q: Q; notes: string };
  let poSeq = 7001;
  async function order(customer: string, quoteDay: number, subject: string, lines: L[], poDay: number | null) {
    const q = await createQuotation(db, {
      customerId: cust(customer),
      quoteDate: day(quoteDay),
      validUntil: day(quoteDay + 30),
      subject,
      notes: null,
      terms: DEFAULT_TERMS,
      status: "SENT",
      lines: lines.map((l) => {
        if (l.custom) {
          return { key: crypto.randomUUID(), serviceId: null, deptCode: l.custom.dept, description: l.custom.description, unitType: null, unitLabel: l.custom.unitLabel, customRatePaise: l.custom.ratePaise, notes: l.notes, ...l.q };
        }
        const v = svcRows.find((x) => x.name === l.name)!;
        return { key: crypto.randomUUID(), serviceId: v.id, deptCode: v.deptCode, description: v.name, unitType: v.unitType, unitLabel: v.unitLabel, customRatePaise: null, notes: l.notes, ...l.q };
      }),
    });
    await changeQuotationStatus(db, q.id, "ACCEPTED", today);
    const ts = await db.select().from(s.tickets).where(eq(s.tickets.quotationId, q.id)).orderBy(s.tickets.seq);
    if (poDay != null) {
      await addPurchaseOrder(db, { ticketIds: ts.map((t) => t.id), poNumber: `PO/${poSeq++}`, poDate: day(poDay), poAmountPaise: ts.reduce((a, t) => a + toPaise(t.taxableValue), 0), fileId: null, notes: null }, today);
    }
    const at = (d: number) => sql`(${day(d)}::date + time '11:00') at time zone 'Asia/Kolkata'`;
    await db.execute(sql`update ticket_events set created_at = ${at(quoteDay + 1)} where ticket_id = any(${sql.param(ts.map((t) => t.id))}::uuid[]) and type = 'OPENED'`);
    if (poDay != null) await db.execute(sql`update ticket_events set created_at = ${at(poDay)} where ticket_id = any(${sql.param(ts.map((t) => t.id))}::uuid[]) and type = 'PO_ADDED'`);
    await db.execute(sql`update tickets set created_at = ${at(quoteDay + 1)}, stage_changed_at = ${at(poDay ?? quoteDay + 1)} where id = any(${sql.param(ts.map((t) => t.id))}::uuid[])`);
    return ts;
  }

  const SAHYADRI = "Sahyadri Auto Components Pvt Ltd";
  const INDUS = "Indus Forge Tier One Pvt Ltd";
  const TALEGAON = "Talegaon Precision Castings";
  const DECCAN = "Deccan Polymers LLP";
  const NASHIK = "Nashik Precision Tools";
  const BHARAT = "Bharat Plastomers Pvt Ltd";

  log("  Story orders: laser cutting, CMM inspection, 5-axis work, Ozone, jobs to plan, on hold, late");
  const [laser] = await order(SAHYADRI, -12, "Quotation for laser cutting", [{ custom: { dept: "PPF", description: "Laser cutting, 3 mm MS sheet brackets", unitLabel: "per piece", ratePaise: 150_00 }, q: { quantity: 40 }, notes: "As per DXF drawing SAC-BR-07" }], -9);
  const [ozone] = await order(BHARAT, -16, "Quotation for ozone ageing test", [{ name: "Ozone chamber", q: { hours: 24 }, notes: "ASTM D1149, 50 pphm, 40 °C" }], -14);
  const [cmm] = await order(INDUS, -6, "Quotation for CMM inspection", [{ custom: { dept: "MET", description: "CMM inspection of forging die", unitLabel: "per die", ratePaise: 6500_00 }, q: { quantity: 2 }, notes: "Full report with 3D deviation map" }], -3);
  const fiveAxis = [
    ...(await order(INDUS, -9, "Quotation for 5-axis machining", [{ name: "5-axis machining", q: { hours: 44 }, notes: "Impeller production batch, 8 pcs" }], -6)),
    ...(await order(SAHYADRI, -7, "Quotation for 5-axis machining", [{ name: "5-axis machining", q: { hours: 32 }, notes: "Die insert machining" }], -4)),
    ...(await order(TALEGAON, -5, "Quotation for 5-axis machining", [{ name: "5-axis machining", q: { hours: 20 }, notes: "Core box finishing" }], -2)),
  ];
  const [urgent] = await order(DECCAN, -3, "Quotation for tensile testing", [{ name: "UTM", q: { samples: 6 }, notes: "Tensile test, ASTM D638, rush" }], -1);
  const [pastPromise] = await order(NASHIK, -10, "Quotation for SLA prototypes", [{ name: "SLA - local resin", q: { ccPerPart: 80, parts: 3 }, notes: "Visual prototypes, revision C" }], -8);
  const [onHold] = await order(INDUS, -8, "Quotation for 3+1 axis machining", [{ name: "3+1 axis machining", q: { hours: 14 }, notes: "Fixture plate, new design" }], -5);
  // Operators' daily work ("Try it as Operator" and the shop-floor tablet): one job for each demo operator on
  // every working day of the next 3 weeks, in their departments. Custom items (customer-supplied material),
  // so the Inventory demo's stock numbers don't change. One order per operator per week.
  const opDays: { op: string; dept: string; day: number; work: (typeof OP_WORK)[string][number] }[] = [];
  for (let d = 0; d < 21; d++) {
    const date = day(d);
    const iso = ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
    if (!pattern.days.includes(iso) || pattern.holidays.has(date)) continue;
    for (const [op, depts] of Object.entries(OP_DEPTS)) {
      const dept = depts[d % depts.length];
      const list = OP_WORK[dept];
      opDays.push({ op, dept, day: d, work: list[d % list.length] });
    }
  }
  const opOrders: { ticketIds: string[]; plan: typeof opDays }[] = [];
  const OP_CUSTOMERS = [NASHIK, BHARAT, TALEGAON, SAHYADRI, INDUS, DECCAN];
  for (const [i, op] of Object.keys(OP_DEPTS).entries()) {
    for (let w = 0; w < 3; w++) {
      const plan = opDays.filter((x) => x.op === op && Math.floor(x.day / 7) === w);
      if (!plan.length) continue;
      const ts = await order(OP_CUSTOMERS[(i * 3 + w) % OP_CUSTOMERS.length], -3, `Quotation for ${plan[0].work.what.toLowerCase()} and more`, plan.map((x) => ({ custom: { dept: x.dept, description: x.work.what, unitLabel: "per job", ratePaise: x.work.rate }, q: { quantity: 1 }, notes: "Customer-supplied material" })), -1);
      opOrders.push({ ticketIds: ts.map((t) => t.id), plan });
    }
  }
  const [late] = await order(TALEGAON, -6, "Quotation for dust testing", [{ name: "Dust spray chamber", q: { hours: 72 }, notes: "IP6X dust test, gearbox housing" }], -3);

  // ---- Past work, invoiced and paid (chamber tests without a materials list, and custom items) ----
  // Kept off the services that have a materials list, so the Inventory demo's numbers don't change.
  let invSeq = 601;
  async function invoiceAndPay(ts: (typeof s.tickets.$inferSelect)[], customer: string, invDay: number, paidDay: number) {
    const total = ts.reduce((a, t) => a + toPaise(t.totalAmount), 0);
    const invDate = day(invDay);
    const invoiceNumber = `MCCIA/${financialYear(new Date(`${invDate}T00:00:00`))}/0${invSeq++}`;
    const fileName = `SAMPLE-INVOICE-${invoiceNumber.replaceAll("/", "-")}.pdf`;
    const bytes = await samplePdf("SAMPLE TAX INVOICE", [
      ["Invoice no.", invoiceNumber],
      ["Invoice date", formatDate(invDate)],
      ["Billed to", customer],
      ["Services", ts.map((t) => `${t.ticketNo}: ${t.snapshot.description}`).join("\n")],
      ["Invoice total incl. GST", `Rs. ${Number(paiseToRupeeString(total)).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`],
    ]);
    // Uploaded after the demo data has saved (scripts/demo-files.ts).
    const path = stageDemoFile(opts.blobFolder ?? "local", "INVOICE", fileName, bytes);
    const fileId = await registerFile(db, { kind: "INVOICE", blobPath: path, fileName, size: bytes.length, mime: "application/pdf" });
    const r = await addInvoice(db, { ticketIds: ts.map((t) => t.id), invoiceNumber, invoiceDate: invDate, amountPaise: total, creditDays: 30, dueDate: dayPlus(invDate, 30), fileId }, today);
    await recordPayment(db, { invoiceId: r.invoiceId, amountPaise: total, tdsPaise: 0, paidOn: day(paidDay), mode: "BANK", reference: `NEFT ${String(810000 + invSeq * 731).padStart(6, "0")}` }, today);
    const ids = ts.map((t) => t.id);
    const at = (d: number) => sql`(${day(d)}::date + time '11:00') at time zone 'Asia/Kolkata'`;
    for (const [type, d] of [["INVOICE_UPLOADED", invDay], ["PAYMENT", paidDay], ["PAID", paidDay]] as const) {
      await db.execute(sql`update ticket_events set created_at = ${at(d)} where ticket_id = any(${sql.param(ids)}::uuid[]) and type = ${type}`);
    }
    await db.update(s.tickets).set({ stageChangedAt: at(paidDay) }).where(inArray(s.tickets.id, ids));
    await db.execute(sql`update payments set created_at = ${at(paidDay)} where invoice_id = ${r.invoiceId}`);
  }
  const CHAKAN = "Chakan EV Motors Pvt Ltd";
  const WESTERN = "Western Drive Systems Ltd";
  const KAVERI = "Kaveri Mobility Parts Pvt Ltd";

  // ---- All jobs, with their ticket and service --------------------------------------------------
  const jobRows = (
    await db.execute<{
      id: string; ticket_id: string; ticket_no: string; stage: string; status: string; dept: string | null; service_id: number | null; unit_type: string | null;
      billable: string; hours_needed: string | null; opened: string; company: string;
    }>(sql`
      select j.id, t.id as ticket_id, t.ticket_no, t.stage, j.status, t.snapshot->>'deptCode' as dept, qi.service_id, qi.unit_type, qi.billable_qty as billable, j.hours_needed,
        coalesce((select min(e.created_at) from ticket_events e where e.ticket_id = t.id and e.type = 'OPENED'), t.created_at)::text as opened, t.snapshot->>'companyName' as company
      from jobs j join tickets t on t.id = j.ticket_id join quotation_items qi on qi.id = t.quotation_item_id
      order by opened`)
  ).rows;
  const job = (ticketId: string) => jobRows.find((j) => j.ticket_id === ticketId)!;
  const hoursOf = (j: { hours_needed: string | null }) => Number(j.hours_needed ?? 0) || 4;

  // ---- History: work already done ------------------------------------------------------------
  const blocksFor = (machineId: string) => blocks.filter((b) => b.machineId === machineId).map((b) => ({ start: b.startAt, end: b.endAt }));
  /** The earliest free time on a machine from `earliest`: never over blocked time or more jobs than it takes at once. */
  function place(m: typeof s.machines.$inferSelect, earliest: Date, hours: number): Span {
    let start = nextWorkingMoment(snapTo30(earliest), pattern, m.runsNonstop);
    for (let guard = 0; guard < 1000; guard++) {
      const span = { start, end: addWorkingHours(start, hours, pattern, m.runsNonstop) };
      const block = blocksFor(m.id).find((b) => overlaps(b, span));
      if (block) {
        start = nextWorkingMoment(block.end, pattern, m.runsNonstop);
        continue;
      }
      const busy = (used.get(m.id) ?? []).filter((u) => overlaps(u, span));
      if (busy.length && maxAtOnce(busy, span) >= m.parallelJobs) {
        const next = busy.map((u) => u.end.getTime()).filter((t) => t > start.getTime());
        start = nextWorkingMoment(new Date(Math.min(...next)), pattern, m.runsNonstop);
        continue;
      }
      return span;
    }
    throw new Error(`No free time found on ${m.name}`);
  }

  /** Work on each machine (booking start to the end of its time logs), to work out use %. */
  const used = new Map<string, Span[]>();
  const OVER = new Map<string, number>(); // ticket no. -> how much longer than quoted it ran
  const LATE_DONE = new Set<string>();
  const doneJobs: { id: string; ticketNo: string; machine: string; start: Date; end: Date }[] = [];
  /** A finished job: booking, time logs, done (and handed over if it was a while ago). */
  async function finished(
    j: Pick<(typeof jobRows)[number], "id" | "ticket_no" | "dept" | "unit_type" | "hours_needed">,
    m: typeof s.machines.$inferSelect,
    earliest: Date,
    opts: { factor?: number; promisedLate?: boolean; handedOver?: boolean; note?: string; span?: Span } = {},
  ) {
    const planned = hoursOf(j);
    const factor = opts.factor ?? 0.92 + rnd() * 0.14; // 92% to 106% of the plan
    const span = opts.span ?? place(m, earliest, planned * Math.max(1, factor));
    const logs = logSpans(span.start, planned * factor, pattern, m.runsNonstop);
    const end = logs.at(-1)!.end;
    if (!opts.span) used.set(m.id, [...(used.get(m.id) ?? []), { start: span.start, end }]);
    const operatorId = operatorFor(j.dept);
    const [b] = await db
      .insert(s.jobBookings)
      .values({ jobId: j.id, machineId: m.id, startAt: span.start, endAt: end, hours: String(planned), operatorId, createdBy: "Demo User", createdAt: new Date(span.start.getTime() - 2 * 24 * HOUR) })
      .returning();
    await db.insert(s.jobTimeLogs).values(logs.map((l, i) => ({ jobId: j.id, bookingId: b.id, machineId: m.id, operatorId, startedAt: l.start, endedAt: l.end, pauseReason: i < logs.length - 1 ? "Other" : null })));
    const doneDate = istDate(end);
    const lead = Math.max(3, Math.ceil(planned / (m.runsNonstop ? 24 : 8.5)) + 2 + Math.floor(rnd() * 3));
    const promised = opts.promisedLate ? dayPlus(doneDate, -1 - Math.floor(rnd() * 2)) : dayPlus(istDate(span.start), lead);
    const handed = opts.handedOver ?? end.getTime() < now.getTime() - 3 * 24 * HOUR;
    const handedOn = dayPlus(doneDate, 1) > today ? today : dayPlus(doneDate, 1);
    const who = operatorName(operatorId);
    const note = opts.note ?? (j.unit_type === "PER_CC" ? "All parts printed, cleaned and checked" : j.unit_type === "PER_SAMPLE" ? "All samples tested, report attached" : "Work complete as per quotation");
    await db
      .update(s.jobs)
      .set({ status: handed ? "HANDED_OVER" : "DONE", operatorId, promisedDate: promised, doneAt: end, doneNote: note, handedOverAt: handed ? handedOn : null, handedOverTo: handed ? "Customer's courier" : null })
      .where(eq(s.jobs.id, j.id));
    const ev = (type: string, message: string, at: Date, data?: Record<string, unknown>) => ({ jobId: j.id, type, message, data, createdBy: who ?? "Demo User", createdAt: at });
    await db.insert(s.jobEvents).values([
      ev("BOOKED", `Booked on ${m.name} (${planned} h)`, new Date(span.start.getTime() - 2 * 24 * HOUR), { bookingId: b.id, machineId: m.id }),
      ev("STARTED", `Started on ${m.name}${who ? ` by ${who}` : ""}`, logs[0].start, { bookingId: b.id }),
      ev("DONE", `Done${who ? ` by ${who}` : ""}: ${note}`, end),
      ...(handed ? [ev("HANDED_OVER", `Handed over on ${handedOn.split("-").reverse().join("/")} to Customer's courier`, new Date(Math.min(istAt(handedOn, 11 * 60).getTime(), now.getTime())))] : []),
    ]);
    if (factor > 1.1) OVER.set(j.ticket_no, factor);
    if (opts.promisedLate) LATE_DONE.add(j.ticket_no);
    doneJobs.push({ id: j.id, ticketNo: j.ticket_no, machine: m.name, start: span.start, end });
  }

  const windowStart = istAt(day(-56), 0);
  const storyIds = new Set([...[laser, ozone, cmm, ...fiveAxis, urgent, pastPromise, onHold, late].map((t) => t.id), ...opOrders.flatMap((o) => o.ticketIds)]);

  let older = 0;
  for (const j of jobRows) {
    if (storyIds.has(j.ticket_id)) continue;
    if (j.stage === "PAID" || j.stage === "PAYMENT") {
      const m = j.service_id != null ? machineForService.get(j.service_id) : undefined;
      const opened = new Date(j.opened);
      if (!m || opened < windowStart) {
        // Before the 8 weeks: done and handed over, no time records.
        const doneDate = dayPlus(istDate(opened), 4);
        await db
          .update(s.jobs)
          .set({ status: "HANDED_OVER", operatorId: operatorFor(j.dept), promisedDate: dayPlus(istDate(opened), 7), doneAt: istAt(doneDate, 16 * 60), doneNote: "Work complete as per quotation", handedOverAt: dayPlus(doneDate, 1), handedOverTo: "Customer's courier" })
          .where(eq(s.jobs.id, j.id));
        older++;
        continue;
      }
      await finished(j, m, new Date(opened.getTime() + 20 * HOUR));
    }
  }
  log(`  ${doneJobs.length} jobs done in the last 8 weeks with bookings and time logs; ${older} older jobs handed over`);

  // Story jobs already done: laser cutting and the Ozone test (both waiting to be invoiced).
  await db.update(s.jobs).set({ hoursNeeded: "6" }).where(eq(s.jobs.id, job(laser.id).id));
  job(laser.id).hours_needed = "6";
  await finished(job(laser.id), machine("5+1 Axis Laser (Rotary Attachment)"), istAt(day(-8), 10 * 60), { note: "40 brackets cut, deburred and packed" });
  await finished(job(ozone.id), machine("Ozone Test Chamber"), istAt(day(-13), 10 * 60), { note: "No cracks at 7x magnification. Report attached" });

  // Orders demo, Billing column (Kaveri): the dust test is done; the high-low test is running now.
  const kaveri = jobRows.filter((j) => j.stage === "BILLING" && !storyIds.has(j.ticket_id));
  const dust = kaveri.find((j) => j.service_id === svcId("Dust spray chamber"));
  const highLow = kaveri.find((j) => j.service_id === svcId("High-low chamber"));
  if (dust) await finished(dust, machine("Dust Spray Test Chamber"), istAt(day(-4), 10 * 60), { handedOver: false, factor: 1 });

  // ---- The last 30 days: enough paid work that most machines run 30-70% of their time ----------
  // Only chamber tests that need no materials and custom items (customer-supplied material, or
  // tests not on the rate card), so the Inventory demo's stock numbers don't change.
  type Fill = { service?: string; custom?: string[]; rate?: number; size: [number, number] };
  const FILL: Record<string, Fill> = {
    "5-Axis VMC (Non-Continuous)": { custom: ["5-axis finishing of mould inserts (customer tooling)", "5-axis machining of turbine blades (customer blanks)"], rate: 1900_00, size: [12, 30] },
    "3-Axis VMC": { custom: ["3-axis milling of pattern plates", "3-axis milling of fixture blocks", "3-axis machining of electrode blanks"], rate: 900_00, size: [12, 28] },
    "5+1 Axis Laser (Rotary Attachment)": { custom: ["Laser cutting, 3 mm MS brackets", "Laser cutting, 2 mm SS panels", "Laser tube cutting, 40 mm SS"], rate: 1600_00, size: [8, 20] },
    "3+1 Axis VMC (Rotary Attachment)": { custom: ["4th-axis machining of manifold blocks (customer tooling)", "Indexed drilling of flanges (customer tooling)"], rate: 450_00, size: [12, 28] },
    "Turn Mill Centre": { custom: ["Turn-mill machining of EN8 shafts", "Turn-mill machining of bronze bushes"], rate: 1200_00, size: [10, 24] },
    "Deep Hole Drilling": { custom: ["Deep hole drilling of ejector pins", "Gun drilling of mould cooling lines"], rate: 1000_00, size: [8, 20] },
    "SLA - 3D Systems 7000 HD": { custom: ["SLA prints in customer-supplied resin", "SLA casting patterns in customer-supplied resin"], rate: 1500_00, size: [10, 24] },
    "SLS - EOS P385": { custom: ["SLS build in customer-supplied PA12 powder"], rate: 1800_00, size: [14, 30] },
    "FDM - Stratasys 450 MC": { custom: ["FDM prints in ASA", "FDM assembly jigs in ABS"], rate: 700_00, size: [12, 30] },
    "Vacuum Casting - KLM": { custom: ["Silicone tool and 10 PU castings", "Vacuum casting, 6 rigid PU parts"], rate: 900_00, size: [12, 24] },
    "Figure 4 Standalone Pro": { custom: ["Figure 4 prints in customer-supplied resin"], rate: 1200_00, size: [8, 18] },
    "Origin 1 SLA": { custom: ["Origin 1 prints in customer-supplied resin"], rate: 1100_00, size: [8, 18] },
    "Xenon Test Chamber": { custom: ["Xenon ageing, SAE J2527 (customer cycle)"], rate: 110_00, size: [120, 240] },
    "Salt Spray Test Chamber": { custom: ["Cyclic corrosion test (customer profile)", "Neutral salt spray with customer-supplied salt"], rate: 55_00, size: [96, 240] },
    "Dust Spray Test Chamber": { custom: ["IP5X dust test with customer-supplied dust"], rate: 500_00, size: [24, 72] },
    "Water Spray Test Chamber": { service: "Water spray chamber", size: [24, 72] },
    "Thermal Shock Test Chamber": { service: "Thermal shock chamber", size: [48, 120] },
    "High-Low Temperature Chamber": { service: "High-low chamber", size: [48, 120] },
    "Universal Testing Machine (UTM)": { custom: ["Compression test, ISO 604 (batch)", "Peel test, ASTM D903 (batch)", "Flexural test, ISO 178 (batch)"], rate: 1500_00, size: [10, 24] },
    "Thermogravimetric Analyser (TGA)": { custom: ["TGA filler content, ISO 11358", "TGA decomposition profile"], rate: 1800_00, size: [8, 20] },
    "Impact Tester": { custom: ["Izod impact, ISO 180 (40 specimens)", "Charpy impact, ISO 179 (40 specimens)"], rate: 1200_00, size: [8, 20] },
    "Accelerated Weathering Tester (QUV/Spray)": { custom: ["UV-B ageing (customer cycle)"], rate: 90_00, size: [120, 240] },
    "Melt Flow Indexer": { custom: ["Melt volume rate, ISO 1133-2 (batch)"], rate: 1200_00, size: [8, 20] },
    "Differential Scanning Calorimeter (DSC)": { custom: ["Oxidation induction time, ISO 11357-6 (batch)"], rate: 1500_00, size: [8, 20] },
    "HDT & VICAT Softening Temperature Tester": { custom: ["HDT series, 30 specimens", "VICAT series, 30 specimens"], rate: 600_00, size: [20, 44] },
    "FTIR Spectrometer": { custom: ["FTIR contamination analysis (batch)"], rate: 1800_00, size: [8, 20] },
    "Hot Air Oven": { service: "Hot air oven", size: [72, 168] },
    "Co-ordinate Measuring Machine (CMM)": { custom: ["CMM inspection of forging dies", "CMM first article inspection"], rate: 1300_00, size: [8, 20] },
  };
  const DEPT_WORK: Record<string, string> = { PPF: "machining and cutting work", RPT: "prototyping work", ENV: "environmental tests", RPL: "polymer tests", MET: "CMM inspection" };
  const POOL: Record<string, string[]> = {
    PPF: [INDUS, SAHYADRI, TALEGAON, CHAKAN, NASHIK],
    RPT: [NASHIK, CHAKAN, TALEGAON, SAHYADRI],
    ENV: [KAVERI, WESTERN, CHAKAN],
    RPL: [DECCAN, BHARAT, WESTERN],
    MET: [INDUS, SAHYADRI, TALEGAON],
  };
  // Story: three chamber tests ran over 10% longer than quoted; two jobs were delivered late.
  const OVER_ON: Record<string, number> = { "Thermal Shock Test Chamber": 1.22, "High-Low Temperature Chamber": 1.17, "Water Spray Test Chamber": 1.24 };
  const LATE_ON = new Set(["3-Axis VMC", "SLS - EOS P385"]);
  const w30 = istAt(day(-30), 0);
  const highLowStart = new Date(now.getTime() - 20 * HOUR); // the job running now
  type Planned = { m: typeof s.machines.$inferSelect; span: Span; hours: number; factor: number; promisedLate: boolean; line: L };
  const planned: Planned[] = [];
  for (const m of machineRows) {
    const f = FILL[m.name];
    if (!f) continue;
    const target = 0.38 + rnd() * 0.27; // 38% to 65%
    const cutoff = m.name === "High-Low Temperature Chamber" ? new Date(highLowStart.getTime() - HOUR) : new Date(now.getTime() - HOUR);
    const base = { window: { start: w30, end: now }, pattern, nonstop: m.runsNonstop, parallelJobs: m.parallelJobs, blocks: blocksFor(m.id) };
    const avail = machineUse({ ...base, bookings: [] }).availableHours;
    let earliest = new Date(w30.getTime() + rnd() * 24 * HOUR);
    let n = 0;
    for (let guard = 0; guard < 40; guard++) {
      const booked = machineUse({ ...base, bookings: used.get(m.id) ?? [] }).bookedHours;
      if (booked >= avail * target) break;
      // Bigger batches, and never past about 68% of the time available.
      const want = Math.round((f.size[0] + rnd() * (f.size[1] - f.size[0])) * 1.5 * 2) / 2;
      const hours = Math.min(want, Math.floor((avail * 0.68 - booked) * 2) / 2);
      if (hours < f.size[0]) break;
      const factor = n === 1 && OVER_ON[m.name] ? OVER_ON[m.name] : 0.93 + rnd() * 0.12;
      const span = place(m, earliest, hours * Math.max(1, factor));
      if (span.end > cutoff) break;
      used.set(m.id, [...(used.get(m.id) ?? []), span]);
      const line: L = f.service
        ? { name: f.service, q: { hours }, notes: "As per the customer's test plan" }
        : { custom: { dept: m.deptCode, description: f.custom![n % f.custom!.length], unitLabel: "per hour", ratePaise: f.rate! }, q: { quantity: hours }, notes: `On ${m.name}` };
      planned.push({ m, span, hours, factor, promisedLate: n === 1 && LATE_ON.has(m.name), line });
      n++;
      earliest = m.parallelJobs > 1 ? new Date(w30.getTime() + rnd() * 5 * 24 * HOUR) : new Date(span.end.getTime() + rnd() * 18 * HOUR);
    }
  }
  // One quotation, PO and invoice per customer per fortnight.
  const groups = new Map<string, { customer: string; jobs: Planned[] }>();
  for (const p of planned.sort((a, b) => a.span.start.getTime() - b.span.start.getTime())) {
    const pool = POOL[p.m.deptCode];
    const customer = pool[Math.floor(rnd() * pool.length)];
    const fortnight = Math.floor(daysBetweenDates(day(-30), istDate(p.span.start)) / 14);
    const key = `${customer}|${p.m.deptCode}|${fortnight}`;
    if (!groups.has(key)) groups.set(key, { customer, jobs: [] });
    groups.get(key)!.jobs.push(p);
  }
  for (const g of groups.values()) {
    const first = istDate(g.jobs[0].span.start);
    const quoteDay = daysBetweenDates(today, first) - 4;
    const ts = await order(g.customer, quoteDay, g.jobs.length > 1 ? `Quotation for ${DEPT_WORK[g.jobs[0].m.deptCode] ?? "work"}` : `Quotation for ${g.jobs[0].line.name ?? g.jobs[0].line.custom!.description.toLowerCase()}`, g.jobs.map((p) => p.line), quoteDay + 2);
    const rows = (
      await db.execute<{ id: string; ticket_id: string; ticket_no: string; dept: string | null; unit_type: string | null; hours_needed: string | null }>(
        sql`select j.id, t.id as ticket_id, t.ticket_no, t.snapshot->>'deptCode' as dept, qi.unit_type, j.hours_needed from jobs j join tickets t on t.id = j.ticket_id join quotation_items qi on qi.id = t.quotation_item_id where t.id = any(${sql.param(ts.map((t) => t.id))}::uuid[])`,
      )
    ).rows;
    for (const [i, t] of ts.entries()) {
      const p = g.jobs[i];
      const r = rows.find((x) => x.ticket_id === t.id)!;
      if (p.line.custom) {
        await db.update(s.jobs).set({ hoursNeeded: String(p.hours) }).where(eq(s.jobs.id, r.id));
        r.hours_needed = String(p.hours);
      }
      await finished(r, p.m, p.span.start, { span: p.span, factor: p.factor, promisedLate: p.promisedLate, handedOver: true });
    }
    const lastEnd = istDate(new Date(Math.max(...g.jobs.map((p) => p.span.end.getTime()))));
    const invDay = Math.min(daysBetweenDates(today, lastEnd) + 1, 0);
    await invoiceAndPay(ts, g.customer, invDay, Math.min(invDay + 10, 0));
  }
  log(`  Last 30 days: ${planned.length} more jobs on ${new Set(planned.map((p) => p.m.id)).size} machines in ${groups.size} paid orders`);

  // ---- Now and the next 2 weeks (through the real booking rules) ------------------------------
  const book = (jobId: string, machineName: string, start: Date, hours: number, extra: { exactStart?: boolean; allowPast?: boolean } = {}) =>
    bookTime(db, { jobId, machineId: machine(machineName).id, start, hours, operatorId: null, allowPast: true, ...extra }, { now });

  // Running now: the high-low test started 20 hours ago.
  if (highLow) {
    const started = new Date(now.getTime() - 20 * HOUR);
    const opId = operatorFor("ENV");
    await db.update(s.jobs).set({ operatorId: opId, promisedDate: day(3) }).where(eq(s.jobs.id, highLow.id));
    const r = await book(highLow.id, "High-Low Temperature Chamber", started, hoursOf(highLow), { exactStart: true });
    await db.insert(s.jobTimeLogs).values({ jobId: highLow.id, bookingId: r.booking.id, machineId: machine("High-Low Temperature Chamber").id, operatorId: opId, startedAt: started, endedAt: null });
    await db.update(s.jobs).set({ status: "RUNNING" }).where(eq(s.jobs.id, highLow.id));
    await db.insert(s.jobEvents).values({ jobId: highLow.id, type: "STARTED", message: `Started on High-Low Temperature Chamber by ${operatorName(opId)}`, createdBy: operatorName(opId), createdAt: started });
  }

  // 5-Axis VMC: booked over 90% of the next 2 weeks.
  const vmc = machine("5-Axis VMC (Non-Continuous)");
  const next2w: Span = { start: now, end: istAt(day(14), 0) };
  const avail = machineUse({ window: next2w, pattern, nonstop: false, parallelJobs: 1, blocks: [], bookings: [] }).availableHours;
  const want = Math.floor(avail * 0.93 * 2) / 2;
  const shares = [0.46, 0.33];
  const fiveHours = [Math.round(want * shares[0] * 2) / 2, Math.round(want * shares[1] * 2) / 2];
  fiveHours.push(Math.max(1, want - fiveHours[0] - fiveHours[1]));
  let cursor = nextWorkingMoment(now, pattern, false);
  for (const [i, t] of fiveAxis.entries()) {
    const j = job(t.id);
    await db.update(s.jobs).set({ hoursNeeded: String(fiveHours[i]), operatorId: operatorFor("PPF") }).where(eq(s.jobs.id, j.id));
    const r = await book(j.id, vmc.name, cursor, fiveHours[i]);
    cursor = r.booking.endAt;
    await db.update(s.jobs).set({ promisedDate: dayPlus(istDate(r.booking.endAt), 2) }).where(eq(s.jobs.id, j.id));
  }

  // CMM inspection next week (custom item on a machine with no rate card service).
  const cmmJob = job(cmm.id);
  await db.update(s.jobs).set({ hoursNeeded: "6", operatorId: operatorFor("MET"), promisedDate: dayPlus(nextMonday, 4) }).where(eq(s.jobs.id, cmmJob.id));
  await book(cmmJob.id, "Co-ordinate Measuring Machine (CMM)", istAt(dayPlus(nextMonday, 2), 9 * 60 + 30), 6);

  // Late: the dust test is booked to finish 2 days after the promised date.
  const lateJob = job(late.id);
  const lateStart = istAt(day(1), 10 * 60);
  await db.update(s.jobs).set({ operatorId: operatorFor("ENV"), promisedDate: istDate(new Date(lateStart.getTime() + 24 * HOUR)) }).where(eq(s.jobs.id, lateJob.id));
  await book(lateJob.id, "Dust Spray Test Chamber", lateStart, 72);

  // Operators' daily work: today's job from now (ready to start), later ones at 10:00 or 14:00.
  const fromNow = new Date(Math.floor(now.getTime() / (30 * 60_000)) * 30 * 60_000);
  let opBooked = 0;
  for (const o of opOrders) {
    for (const [k, ticketId] of o.ticketIds.entries()) {
      const x = o.plan[k];
      const j = job(ticketId);
      const opId = team.find((t) => t.name === x.op)?.id ?? null;
      await db.update(s.jobs).set({ hoursNeeded: String(x.work.hours), operatorId: opId, promisedDate: day(x.day + 2) }).where(eq(s.jobs.id, j.id));
      const starts = x.day === 0 ? [fromNow] : [istAt(day(x.day), 10 * 60), istAt(day(x.day), 14 * 60)];
      done: for (const start of starts) {
        for (const name of OP_MACHINES[x.dept]) {
          try {
            const r = await book(j.id, name, start, x.work.hours, { exactStart: true });
            await db.update(s.jobBookings).set({ operatorId: opId }).where(eq(s.jobBookings.id, r.booking.id));
            opBooked++;
            break done;
          } catch {
            /* that machine is busy then: try the next one */
          }
        }
      }
    }
  }
  log(`  Operators' daily work: ${opBooked} jobs for Amit, Rohan and Priya over the next 3 weeks`);

  // Waiting for PO (Deccan): tentative holds. The Xenon one expires tomorrow; the melt flow one has expired.
  const deccanXenon = jobRows.find((j) => j.stage === "WAITING_PO" && j.service_id === svcId("Xenon test chamber"));
  const deccanMfi = jobRows.find((j) => j.stage === "WAITING_PO" && j.service_id === svcId("Melt flow index"));
  if (deccanXenon) {
    const r = await book(deccanXenon.id, "Xenon Test Chamber", istAt(day(3), 9 * 60), hoursOf(deccanXenon));
    await db.update(s.jobBookings).set({ holdUntil: day(1), createdAt: istAt(day(-6), 12 * 60) }).where(eq(s.jobBookings.id, r.booking.id));
    await db.update(s.jobs).set({ operatorId: operatorFor("ENV"), promisedDate: day(8) }).where(eq(s.jobs.id, deccanXenon.id));
  }
  if (deccanMfi) {
    const r = await book(deccanMfi.id, "Melt Flow Indexer", istAt(day(2), 14 * 60), hoursOf(deccanMfi));
    await db.update(s.jobBookings).set({ holdUntil: day(-1), createdAt: istAt(day(-8), 12 * 60) }).where(eq(s.jobBookings.id, r.booking.id));
    await db.update(s.jobs).set({ operatorId: operatorFor("RPL"), promisedDate: day(6) }).where(eq(s.jobs.id, deccanMfi.id));
  }

  // Jobs to plan: one urgent, one past its promised date. On hold: waiting for drawings.
  await db.update(s.jobs).set({ priority: "URGENT", promisedDate: day(4), operatorId: operatorFor("RPL") }).where(eq(s.jobs.id, job(urgent.id).id));
  await db.update(s.jobs).set({ promisedDate: day(-2) }).where(eq(s.jobs.id, job(pastPromise.id).id));
  const holdJob = job(onHold.id);
  await db.update(s.jobs).set({ status: "ON_HOLD", holdReason: "Waiting for customer drawings", promisedDate: day(12), operatorId: operatorFor("PPF") }).where(eq(s.jobs.id, holdJob.id));
  await db.insert(s.jobEvents).values({ jobId: holdJob.id, type: "ON_HOLD", message: "On hold: Waiting for customer drawings", createdBy: "Demo User", createdAt: istAt(day(-4), 15 * 60) });

  // ---- The numbers for the summary ------------------------------------------------------------
  const vmcBooked = await db.execute<{ start_at: string; end_at: string }>(sql`select start_at::text, end_at::text from job_bookings where machine_id = ${vmc.id} and cancelled_at is null and end_at > ${now}`);
  const use = machineUse({ window: next2w, pattern, nonstop: false, parallelJobs: 1, blocks: [], bookings: vmcBooked.rows.map((b) => ({ start: new Date(b.start_at), end: new Date(b.end_at) })) });
  const over = [...OVER.entries()];
  const story = {
    machines: machineRows.length,
    fillJobs: planned.length,
    doneWithLogs: doneJobs.length,
    vmcBookedPct: Math.round(use.bookedPct ?? 0),
    overQuoted: over.map(([t, f]) => `${t} +${Math.round((f - 1) * 100)}%`),
    lateDelivered: [...LATE_DONE],
  };
  log(`  5-Axis VMC booked ${story.vmcBookedPct}% for the next 2 weeks; over quoted: ${story.overQuoted.join(", ")}; delivered late: ${story.lateDelivered.join(", ")}`);
  return story;
}
