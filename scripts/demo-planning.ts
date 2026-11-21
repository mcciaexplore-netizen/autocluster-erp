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
import { put } from "@vercel/blob";
import { eq, inArray, sql } from "drizzle-orm";
import type { DB, Tx } from "../db/client";
import { bookTime } from "../db/booking-writer";
import { addInvoice } from "../db/invoice-writer";
import { recordPayment } from "../db/payment-writer";
import { addPurchaseOrder, registerFile } from "../db/po-writer";
import { createQuotation } from "../db/quote-writer";
import * as s from "../db/schema";
import { changeQuotationStatus } from "../db/ticket-writer";
import { addWorkingHours, dayPlus, istAt, istDate, nextWorkingMoment, overlaps, patternFromSettings, segmentsOn, snapTo30, type Span, type WorkPattern } from "../lib/planning/hours";
import { machineUse, weekStart } from "../lib/planning/use";
import { blobAuth, blobConfigured } from "../lib/blob";
import { uploadPath, type BlobEnv } from "../lib/files";
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

const OPERATOR_FOR: Record<string, string> = { PPF: "Amit Patil", MET: "Amit Patil", RPT: "Rohan Deshpande", ENV: "Priya Shah", RPL: "Priya Shah" };
const HOUR = 3_600_000;

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

export async function loadPlanningDemo(conn: DB | Tx, opts: { log?: (m: string) => void; now?: Date; blobFolder?: BlobEnv; onUpload?: (path: string) => void } = {}) {
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
  const lastMonth = new Date(Date.UTC(year, Number(today.slice(5, 7)) - 2, 20)).toISOString().slice(0, 10);
  const nextMonday = dayPlus(weekStart(today), 7);
  const blocks = [
    { machineId: machine("SLA - 3D Systems 7000 HD").id, type: "BREAKDOWN" as const, startAt: istAt(lastMonth, 10 * 60), endAt: istAt(dayPlus(lastMonth, 2), 17 * 60), note: "Laser power dropped mid-build. Service engineer replaced the scanner mirror." },
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
    let path = uploadPath(opts.blobFolder ?? "local", "INVOICE", fileName);
    if (blobConfigured()) {
      const b = await put(path, Buffer.from(bytes), { access: "private", addRandomSuffix: true, contentType: "application/pdf", ...blobAuth() });
      path = b.pathname;
      opts.onUpload?.(path);
    }
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
  const PAST: { d: number; customer: string; line: L; machine: string; hours?: number }[] = [
    { d: -51, customer: SAHYADRI, line: { custom: { dept: "PPF", description: "Laser cutting, 2 mm SS sheet panels", unitLabel: "per piece", ratePaise: 120_00 }, q: { quantity: 60 }, notes: "As per DXF drawing SAC-PN-02" }, machine: "5+1 Axis Laser (Rotary Attachment)", hours: 8 },
    { d: -52, customer: WESTERN, line: { name: "Thermal shock chamber", q: { hours: 48 }, notes: "As per IEC 60068-2-14" }, machine: "Thermal Shock Test Chamber" },
    { d: -47, customer: INDUS, line: { custom: { dept: "MET", description: "CMM inspection of trimming die", unitLabel: "per die", ratePaise: 6500_00 }, q: { quantity: 1 }, notes: "Report with GD&T check" }, machine: "Co-ordinate Measuring Machine (CMM)", hours: 5 },
    { d: -45, customer: KAVERI, line: { name: "High-low chamber", q: { hours: 36 }, notes: "-40 °C to +85 °C cycling" }, machine: "High-Low Temperature Chamber" },
    { d: -43, customer: TALEGAON, line: { custom: { dept: "PPF", description: "3-axis milling of pattern plates", unitLabel: "per hour", ratePaise: 900_00 }, q: { quantity: 14 }, notes: "Aluminium pattern plates, 2 pcs" }, machine: "3-Axis VMC", hours: 14 },
    { d: -40, customer: WESTERN, line: { name: "Water spray chamber", q: { hours: 16 }, notes: "IPX4 splash test" }, machine: "Water Spray Test Chamber" },
    { d: -38, customer: CHAKAN, line: { custom: { dept: "PPF", description: "Laser cutting, 4 mm MS motor brackets", unitLabel: "per piece", ratePaise: 180_00 }, q: { quantity: 80 }, notes: "As per drawing CEV-MB-11" }, machine: "5+1 Axis Laser (Rotary Attachment)", hours: 10 },
    { d: -35, customer: TALEGAON, line: { custom: { dept: "PPF", description: "Turn-mill machining of shafts", unitLabel: "per piece", ratePaise: 1400_00 }, q: { quantity: 12 }, notes: "EN8 shafts with milled keyways" }, machine: "Turn Mill Centre", hours: 9 },
    { d: -33, customer: CHAKAN, line: { name: "Thermal shock chamber", q: { hours: 72 }, notes: "Motor controller housing, 100 cycles" }, machine: "Thermal Shock Test Chamber" },
    { d: -31, customer: SAHYADRI, line: { custom: { dept: "MET", description: "CMM inspection of die-cast housings", unitLabel: "per part", ratePaise: 2500_00 }, q: { quantity: 2 }, notes: "First article inspection" }, machine: "Co-ordinate Measuring Machine (CMM)", hours: 6 },
    { d: -29, customer: KAVERI, line: { name: "High-low chamber", q: { hours: 48 }, notes: "-30 °C to +70 °C, 10 cycles" }, machine: "High-Low Temperature Chamber" },
    { d: -27, customer: INDUS, line: { custom: { dept: "PPF", description: "3-axis milling of fixture blocks", unitLabel: "per hour", ratePaise: 900_00 }, q: { quantity: 18 }, notes: "Fixture blocks, 4 pcs" }, machine: "3-Axis VMC", hours: 18 },
    { d: -25, customer: CHAKAN, line: { name: "Water spray chamber", q: { hours: 24 }, notes: "IPX5 water jet test, charger" }, machine: "Water Spray Test Chamber" },
    { d: -24, customer: NASHIK, line: { custom: { dept: "PPF", description: "Deep hole drilling of ejector pins", unitLabel: "per piece", ratePaise: 650_00 }, q: { quantity: 10 }, notes: "450 mm deep, 12 mm dia" }, machine: "Deep Hole Drilling", hours: 7 },
  ];
  const pastMachine = new Map<string, { machine: string; hours?: number }>();
  for (const p of PAST) {
    const ts = await order(p.customer, p.d - 4, p.line.name ? `Quotation for ${p.line.name}` : `Quotation for ${p.line.custom!.description.toLowerCase()}`, [p.line], p.d - 2);
    await invoiceAndPay(ts, p.customer, Math.min(p.d + 7, -1), Math.min(p.d + 21, -1));
    for (const t of ts) pastMachine.set(t.id, { machine: p.machine, hours: p.hours });
  }
  log(`  ${PAST.length} more past jobs (chamber tests and custom items), invoiced and paid`);

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
  const hoursOf = (j: (typeof jobRows)[number]) => Number(j.hours_needed ?? 0) || 4;

  // ---- History: work already done ------------------------------------------------------------
  const blocksFor = (machineId: string) => blocks.filter((b) => b.machineId === machineId).map((b) => ({ start: b.startAt, end: b.endAt }));
  const lanes = new Map<string, Date[]>();
  /** The next free time on a machine from `earliest`, never over blocked time. */
  function place(m: typeof s.machines.$inferSelect, earliest: Date, hours: number): Span {
    const ls = lanes.get(m.id) ?? Array.from({ length: m.parallelJobs }, () => new Date(0));
    lanes.set(m.id, ls);
    const lane = ls.indexOf(ls.reduce((a, b) => (a < b ? a : b)));
    let start = nextWorkingMoment(snapTo30(new Date(Math.max(earliest.getTime(), ls[lane].getTime()))), pattern, m.runsNonstop);
    let end = addWorkingHours(start, hours, pattern, m.runsNonstop);
    for (const b of blocksFor(m.id)) {
      if (overlaps(b, { start, end })) {
        start = nextWorkingMoment(b.end, pattern, m.runsNonstop);
        end = addWorkingHours(start, hours, pattern, m.runsNonstop);
      }
    }
    ls[lane] = end;
    return { start, end };
  }

  const OVER = new Map<string, number>(); // ticket no. -> how much longer than quoted it ran
  const LATE_DONE = new Set<string>();
  const doneJobs: { id: string; ticketNo: string; machine: string; start: Date; end: Date }[] = [];
  /** A finished job: booking, time logs, done (and handed over if it was a while ago). */
  async function finished(j: (typeof jobRows)[number], m: typeof s.machines.$inferSelect, earliest: Date, opts: { factor?: number; promisedLate?: boolean; handedOver?: boolean; note?: string } = {}) {
    const planned = hoursOf(j);
    const span = place(m, earliest, planned);
    const factor = opts.factor ?? 0.92 + rnd() * 0.14; // 92% to 106% of the plan
    const logs = logSpans(span.start, planned * factor, pattern, m.runsNonstop);
    const end = logs.at(-1)!.end;
    const lanesOf = lanes.get(m.id)!;
    lanesOf[lanesOf.indexOf(span.end)] = new Date(Math.max(span.end.getTime(), end.getTime()));
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
    const who = operatorName(operatorId);
    const note = opts.note ?? (j.unit_type === "PER_CC" ? "All parts printed, cleaned and checked" : j.unit_type === "PER_SAMPLE" ? "All samples tested, report attached" : "Work complete as per quotation");
    await db
      .update(s.jobs)
      .set({ status: handed ? "HANDED_OVER" : "DONE", operatorId, promisedDate: promised, doneAt: end, doneNote: note, handedOverAt: handed ? dayPlus(doneDate, 1) : null, handedOverTo: handed ? "Customer's courier" : null })
      .where(eq(s.jobs.id, j.id));
    const ev = (type: string, message: string, at: Date, data?: Record<string, unknown>) => ({ jobId: j.id, type, message, data, createdBy: who ?? "Demo User", createdAt: at });
    await db.insert(s.jobEvents).values([
      ev("BOOKED", `Booked on ${m.name} (${planned} h)`, new Date(span.start.getTime() - 2 * 24 * HOUR), { bookingId: b.id, machineId: m.id }),
      ev("STARTED", `Started on ${m.name}${who ? ` by ${who}` : ""}`, logs[0].start, { bookingId: b.id }),
      ev("DONE", `Done${who ? ` by ${who}` : ""}: ${note}`, end),
      ...(handed ? [ev("HANDED_OVER", `Handed over on ${dayPlus(doneDate, 1).split("-").reverse().join("/")} to Customer's courier`, istAt(dayPlus(doneDate, 1), 11 * 60))] : []),
    ]);
    if (factor > 1.1) OVER.set(j.ticket_no, factor);
    if (opts.promisedLate) LATE_DONE.add(j.ticket_no);
    doneJobs.push({ id: j.id, ticketNo: j.ticket_no, machine: m.name, start: span.start, end });
  }

  const windowStart = istAt(day(-56), 0);
  const storyIds = new Set([laser, ozone, cmm, ...fiveAxis, urgent, pastPromise, onHold, late].map((t) => t.id));
  // Three past machining jobs (per hour) that ran longer than quoted, and two delivered late.
  const pastPerHour = jobRows.filter((j) => j.stage === "PAID" || j.stage === "PAYMENT").filter((j) => j.unit_type === "PER_HOUR" && j.dept === "PPF" && new Date(j.opened) >= windowStart);
  const overFactors = new Map(pastPerHour.slice(-3).map((j, i) => [j.id, [1.26, 1.15, 1.22][i]]));
  const pastOthers = jobRows.filter((j) => (j.stage === "PAID" || j.stage === "PAYMENT") && j.unit_type !== "PER_HOUR" && new Date(j.opened) >= windowStart);
  const lateIds = new Set([pastOthers[1]?.id, pastOthers[pastOthers.length - 2]?.id].filter(Boolean));

  let older = 0;
  for (const j of jobRows) {
    if (storyIds.has(j.ticket_id)) continue;
    if (j.stage === "PAID" || j.stage === "PAYMENT") {
      const pm = pastMachine.get(j.ticket_id);
      if (pm?.hours) {
        await db.update(s.jobs).set({ hoursNeeded: String(pm.hours) }).where(eq(s.jobs.id, j.id));
        j.hours_needed = String(pm.hours);
      }
      const m = pm ? machine(pm.machine) : j.service_id != null ? machineForService.get(j.service_id) : undefined;
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
      await finished(j, m, new Date(opened.getTime() + 20 * HOUR), { factor: overFactors.get(j.id), promisedLate: lateIds.has(j.id) });
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
    doneWithLogs: doneJobs.length,
    vmcBookedPct: Math.round(use.bookedPct ?? 0),
    overQuoted: over.map(([t, f]) => `${t} +${Math.round((f - 1) * 100)}%`),
    lateDelivered: [...LATE_DONE],
  };
  log(`  5-Axis VMC booked ${story.vmcBookedPct}% for the next 2 weeks; over quoted: ${story.overQuoted.join(", ")}; delivered late: ${story.lateDelivered.join(", ")}`);
  return story;
}
