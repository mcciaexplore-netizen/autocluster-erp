/**
 * Read-only Planning queries used by pages. Every function calls connection() first,
 * so data is always read fresh at request time (and the build never touches the database).
 */
import "server-only";
import { and, asc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { connection } from "next/server";
import { db } from "@/db";
import { bookingsClashingWithBlocks } from "@/db/booking-writer";
import { nextMachineCode } from "@/db/machine-writer";
import { runningLogs } from "@/db/work-writer";
import { departments, holidays, jobBookings, jobs, jobTimeLogs, machineBlocks, machineServices, machines, services, settings, teamMembers, tickets } from "@/db/schema";
import { dayPlus, istAt, istDate, patternFromSettings, type Span, type WorkPattern } from "@/lib/planning/hours";
import { JOB_STATUS_UI, type JobStatusName } from "@/lib/planning/job-status";
import { machineUse, weekStart } from "@/lib/planning/use";
import { isOverrun, quotedVsActual } from "@/lib/planning/work";

/** Working hours and holidays, as a pattern for the working-hours maths. */
export async function getPlanningSettings() {
  await connection();
  const [[s], hs] = await Promise.all([db.select().from(settings).where(eq(settings.id, 1)), db.select().from(holidays).orderBy(asc(holidays.date))]);
  if (!s) throw new Error("Settings are missing. Run: npm run db:seed");
  return {
    settings: s,
    holidays: hs,
    pattern: patternFromSettings(s, hs.map((h) => h.date)),
  };
}
export type PlanningSettings = Awaited<ReturnType<typeof getPlanningSettings>>;

export async function listHolidays() {
  await connection();
  return db.select().from(holidays).orderBy(asc(holidays.date));
}

export async function listDepartments() {
  await connection();
  return db.select({ code: departments.code, name: departments.name }).from(departments).orderBy(asc(departments.sortOrder));
}

/** What the machine form chooses from: departments, the whole rate card, and the next code. */
export async function getMachineFormOptions() {
  await connection();
  const [depts, svcs, nextCode] = await Promise.all([
    db.select({ code: departments.code, name: departments.name }).from(departments).orderBy(asc(departments.sortOrder)),
    db.select({ id: services.id, name: services.name, deptCode: services.deptCode, unitLabel: services.unitLabel, isActive: services.isActive }).from(services).orderBy(asc(services.sortOrder)),
    nextMachineCode(db),
  ]);
  return { departments: depts, services: svcs, nextCode };
}
export type MachineFormOptions = Awaited<ReturnType<typeof getMachineFormOptions>>;

type BookingRow = { id: string; machineId: string; jobId: string; startAt: Date; endAt: Date; hours: string; isTentative: boolean; holdUntil: string | null; ticketNo: string; company: string; service: string; jobStatus: string };

async function bookingsBetween(from: Date, to: Date, machineId?: string): Promise<BookingRow[]> {
  return db
    .select({
      id: jobBookings.id,
      machineId: jobBookings.machineId,
      jobId: jobBookings.jobId,
      startAt: jobBookings.startAt,
      endAt: jobBookings.endAt,
      hours: jobBookings.hours,
      isTentative: jobBookings.isTentative,
      holdUntil: jobBookings.holdUntil,
      ticketNo: tickets.ticketNo,
      company: sql<string>`${tickets.snapshot}->>'companyName'`,
      service: sql<string>`${tickets.snapshot}->>'description'`,
      jobStatus: jobs.status,
    })
    .from(jobBookings)
    .innerJoin(jobs, eq(jobs.id, jobBookings.jobId))
    .innerJoin(tickets, eq(tickets.id, jobs.ticketId))
    .where(and(isNull(jobBookings.cancelledAt), lt(jobBookings.startAt, to), gt(jobBookings.endAt, from), machineId ? eq(jobBookings.machineId, machineId) : undefined))
    .orderBy(asc(jobBookings.startAt));
}

async function blocksBetween(from: Date, to: Date, machineId?: string) {
  return db
    .select()
    .from(machineBlocks)
    .where(and(lt(machineBlocks.startAt, to), gt(machineBlocks.endAt, from), machineId ? eq(machineBlocks.machineId, machineId) : undefined))
    .orderBy(asc(machineBlocks.startAt));
}

/** The India week (Monday to Monday) holding a date. */
export function weekWindow(date: string): Span & { from: string } {
  const from = weekStart(date);
  return { from, start: istAt(from, 0), end: istAt(dayPlus(from, 7), 0) };
}
function monthWindow(date: string): Span {
  const first = `${date.slice(0, 7)}-01`;
  const next = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 1)).toISOString().slice(0, 10);
  return { start: istAt(first, 0), end: istAt(next, 0) };
}

function machineUseFor(m: { id: string; runsNonstop: boolean; parallelJobs: number }, window: Span, pattern: WorkPattern, bookings: BookingRow[], blocks: { machineId: string; startAt: Date; endAt: Date }[]) {
  return machineUse({
    window,
    pattern,
    nonstop: m.runsNonstop,
    parallelJobs: m.parallelJobs,
    blocks: blocks.filter((b) => b.machineId === m.id).map((b) => ({ start: b.startAt, end: b.endAt })),
    bookings: bookings.filter((b) => b.machineId === m.id).map((b) => ({ start: b.startAt, end: b.endAt })),
  });
}

/**
 * Machines still marked Breakdown after their expected end (the breakdown block has ended):
 * "Still broken down? Expected back ...". Map of machine id -> expected end.
 */
async function overdueBreakdowns(now: Date): Promise<Map<string, Date>> {
  const rows = await db.execute<{ id: string; expected: string }>(sql`
    select m.id, max(b.end_at)::text as expected
    from machines m join machine_blocks b on b.machine_id = m.id and b.type = 'BREAKDOWN'
    where m.status = 'BREAKDOWN'
    group by m.id
    having max(b.end_at) <= ${now}`);
  return new Map(rows.rows.map((r) => [r.id, new Date(r.expected)]));
}

/** For "Needs attention": machines still broken down after their expected end. */
export async function listOverdueBreakdowns() {
  await connection();
  const now = new Date();
  const map = await overdueBreakdowns(now);
  if (!map.size) return [];
  const rows = await db.select({ id: machines.id, name: machines.name, code: machines.code }).from(machines).where(sql`${machines.id} = any(${sql.param([...map.keys()])}::uuid[])`);
  return rows.map((m) => ({ ...m, expectedEnd: map.get(m.id)! })).sort((a, b) => a.expectedEnd.getTime() - b.expectedEnd.getTime());
}

/** Machines with their services, what's running now, the next booking and use % this week. */
export async function listMachines() {
  await connection();
  const now = new Date();
  const week = weekWindow(istDate(now));
  const [plan, rows, links, depts, weekBookings, weekBlocks, upcoming, blockedNow, overdue, running] = await Promise.all([
    getPlanningSettings(),
    db.select().from(machines).orderBy(asc(machines.sortOrder), asc(machines.name)),
    db.select({ machineId: machineServices.machineId, serviceId: services.id, name: services.name }).from(machineServices).innerJoin(services, eq(services.id, machineServices.serviceId)),
    db.select().from(departments).orderBy(asc(departments.sortOrder)),
    bookingsBetween(week.start, week.end),
    blocksBetween(week.start, week.end),
    bookingsBetween(now, new Date(now.getTime() + 120 * 86_400_000)),
    blocksBetween(now, new Date(now.getTime() + 1)),
    overdueBreakdowns(now),
    runningLogs(db),
  ]);
  const list = rows.map((m) => {
    const mine = upcoming.filter((b) => b.machineId === m.id);
    return {
      ...m,
      services: links.filter((l) => l.machineId === m.id).map((l) => ({ id: l.serviceId, name: l.name })),
      now: mine.filter((b) => b.startAt <= now && b.endAt > now),
      running: running.filter((r) => r.machine_id === m.id).map((r) => ({ ticketNo: r.ticket_no, company: r.company })),
      next: mine.find((b) => b.startAt > now) ?? null,
      blockedNow: blockedNow.find((b) => b.machineId === m.id) ?? null,
      overdueBreakdown: overdue.get(m.id) ?? null,
      use: machineUseFor(m, week, plan.pattern, weekBookings, weekBlocks),
    };
  });
  return { departments: depts, machines: list };
}
export type MachineListRow = Awaited<ReturnType<typeof listMachines>>["machines"][number];

/** One machine: its week (bookings and blocked time), use %, services and job history. */
export async function getMachine(id: string, weekOf?: string) {
  await connection();
  const [m] = await db.select().from(machines).where(eq(machines.id, id));
  if (!m) return null;
  const now = new Date();
  const week = weekWindow(weekOf && /^\d{4}-\d{2}-\d{2}$/.test(weekOf) ? weekOf : istDate(now));
  const month = monthWindow(istDate(now));
  const thisWeek = weekWindow(istDate(now));
  const [plan, svcs, dept, wb, wbl, mb, mbl, twb, twbl, history, overdue, clashes] = await Promise.all([
    getPlanningSettings(),
    db.select({ id: services.id, name: services.name, deptCode: services.deptCode }).from(machineServices).innerJoin(services, eq(services.id, machineServices.serviceId)).where(eq(machineServices.machineId, id)).orderBy(asc(services.sortOrder)),
    db.select().from(departments).where(eq(departments.code, m.deptCode)),
    bookingsBetween(week.start, week.end, id),
    blocksBetween(week.start, week.end, id),
    bookingsBetween(month.start, month.end, id),
    blocksBetween(month.start, month.end, id),
    bookingsBetween(thisWeek.start, thisWeek.end, id),
    blocksBetween(thisWeek.start, thisWeek.end, id),
    db
      .select({ jobId: jobs.id, ticketNo: tickets.ticketNo, company: sql<string>`${tickets.snapshot}->>'companyName'`, service: sql<string>`${tickets.snapshot}->>'description'`, status: jobs.status, startAt: sql<Date>`min(${jobBookings.startAt})`, endAt: sql<Date>`max(${jobBookings.endAt})`, operator: sql<string | null>`max(${teamMembers.name})` })
      .from(jobBookings)
      .innerJoin(jobs, eq(jobs.id, jobBookings.jobId))
      .innerJoin(tickets, eq(tickets.id, jobs.ticketId))
      .leftJoin(teamMembers, eq(teamMembers.id, jobBookings.operatorId))
      .where(and(eq(jobBookings.machineId, id), isNull(jobBookings.cancelledAt), lt(jobBookings.startAt, now)))
      .groupBy(jobs.id, tickets.ticketNo, tickets.snapshot, jobs.status)
      .orderBy(sql`min(${jobBookings.startAt}) desc`)
      .limit(50),
    overdueBreakdowns(now),
    bookingsClashingWithBlocks(db, now),
  ]);
  return {
    clashes: clashes.filter((c) => c.machineId === id),
    machine: m,
    department: dept[0] ?? null,
    services: svcs,
    week: { from: week.from, bookings: wb, blocks: wbl },
    useWeek: machineUseFor(m, thisWeek, plan.pattern, twb, twbl),
    useMonth: machineUseFor(m, month, plan.pattern, mb, mbl),
    history: history.map((h) => ({ ...h, startAt: new Date(h.startAt), endAt: new Date(h.endAt) })),
    pattern: plan.pattern,
    overdueBreakdown: overdue.get(id) ?? null,
  };
}
export type MachineDetail = NonNullable<Awaited<ReturnType<typeof getMachine>>>;

/** Active machines for pickers (block time etc.). */
export async function getMachinePicks() {
  await connection();
  return db
    .select({ id: machines.id, name: machines.name, code: machines.code, deptCode: machines.deptCode, status: machines.status })
    .from(machines)
    .where(eq(machines.isActive, true))
    .orderBy(asc(machines.deptCode), asc(machines.sortOrder), asc(machines.name));
}

// ---- jobs -------------------------------------------------------------------------------------------

export { JOB_STATUS_UI as JOB_STATUS, type JobStatusName } from "@/lib/planning/job-status";

export interface JobFilters {
  q?: string;
  status?: JobStatusName;
  dept?: string;
  machine?: string;
  operator?: string;
  promisedBy?: string;
  late?: boolean;
  notPlanned?: boolean;
  overQuoted?: boolean;
  /** "Invoiced before planning started: check if work is done". */
  check?: boolean;
}

export function jobFiltersFromParams(sp: Record<string, string | string[] | undefined>): JobFilters {
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const uuid = (v: string) => (/^[0-9a-f-]{36}$/i.test(v) ? v : undefined);
  return {
    q: one("q").slice(0, 100) || undefined,
    status: (Object.keys(JOB_STATUS_UI) as JobStatusName[]).find((s) => s === one("status")),
    dept: /^[A-Z]{2,6}$/.test(one("dept")) ? one("dept") : undefined,
    machine: uuid(one("machine")),
    operator: uuid(one("operator")),
    promisedBy: /^\d{4}-\d{2}-\d{2}$/.test(one("promised")) ? one("promised") : undefined,
    late: one("late") === "1",
    notPlanned: one("notplanned") === "1",
    overQuoted: one("over") === "1",
    check: one("check") === "1",
  };
}

/** Actual hours = the running periods, pauses left out (a running period still open counts to now). */
const ACTUAL_SQL = sql`(select coalesce(sum(extract(epoch from (coalesce(l.ended_at, now()) - l.started_at))), 0) / 3600 from job_time_logs l where l.job_id = j.id)`;

/** The jobs list (and its Excel), newest first, with planned and actual hours. */
export async function listJobs(f: JobFilters = {}, limit = 500) {
  await connection();
  const today = istDate(new Date());
  const [set] = await db.select({ alert: settings.actualVsQuotedAlertPct }).from(settings).where(eq(settings.id, 1));
  const alert = set?.alert ?? 10;
  const where = [sql`true`];
  if (f.q) {
    const t = `%${f.q}%`;
    where.push(sql`(t.ticket_no ilike ${t} or t.snapshot->>'companyName' ilike ${t} or t.snapshot->>'description' ilike ${t})`);
  }
  if (f.status) where.push(sql`j.status = ${f.status}`);
  if (f.dept) where.push(sql`coalesce(t.snapshot->>'deptCode', '') = ${f.dept}`);
  if (f.machine) where.push(sql`exists (select 1 from job_bookings b where b.job_id = j.id and b.cancelled_at is null and b.machine_id = ${f.machine})`);
  if (f.operator) where.push(sql`j.operator_id = ${f.operator}`);
  if (f.promisedBy) where.push(sql`j.promised_date <= ${f.promisedBy}`);
  if (f.notPlanned) where.push(sql`j.status = 'TO_PLAN'`);
  if (f.check) where.push(sql`j.check_work_done and j.status not in ('DONE', 'HANDED_OVER', 'CANCELLED')`);
  const rows = await db.execute<{
    id: string; ticket_id: string; ticket_no: string; company: string; service: string; dept: string | null; status: JobStatusName; priority: "NORMAL" | "URGENT";
    promised_date: string | null; hours_needed: string | null; planned: string | null; first_start: string | null; last_end: string | null; machines: string[] | null;
    operator: string | null; operator_id: string | null; actual: string; per_hour: boolean; billable: string; done_at: string | null; stage: string; check_work_done: boolean;
  }>(sql`
    select j.id, t.id as ticket_id, t.ticket_no, t.snapshot->>'companyName' as company, t.snapshot->>'description' as service, t.snapshot->>'deptCode' as dept,
      j.status, j.priority, j.promised_date::text, j.hours_needed, j.operator_id, tm.name as operator, j.done_at::text, t.stage, j.check_work_done,
      (select sum(b.hours) from job_bookings b where b.job_id = j.id and b.cancelled_at is null) as planned,
      (select min(b.start_at)::text from job_bookings b where b.job_id = j.id and b.cancelled_at is null) as first_start,
      (select max(b.end_at)::text from job_bookings b where b.job_id = j.id and b.cancelled_at is null) as last_end,
      (select array_agg(distinct m.name) from job_bookings b join machines m on m.id = b.machine_id where b.job_id = j.id and b.cancelled_at is null) as machines,
      ${ACTUAL_SQL} as actual,
      (qi.unit_type in ('PER_HOUR', 'PER_HOUR_3_SAMPLES') and not qi.is_custom_item) as per_hour, qi.billable_qty as billable
    from jobs j
    join tickets t on t.id = j.ticket_id
    join quotation_items qi on qi.id = t.quotation_item_id
    left join team_members tm on tm.id = j.operator_id
    where ${and(...where)}
    order by case j.status when 'RUNNING' then 0 when 'TO_PLAN' then 1 when 'PLANNED' then 2 when 'ON_HOLD' then 3 else 4 end, j.priority desc, coalesce(j.promised_date, '9999-12-31'), t.ticket_no desc
    limit ${limit}`);
  const list = rows.rows.map((r) => {
    const open = !["DONE", "HANDED_OVER", "CANCELLED"].includes(r.status);
    const lastEnd = r.last_end ? new Date(r.last_end) : null;
    const late = !!r.promised_date && (open ? today > r.promised_date || (!!lastEnd && istDate(lastEnd) > r.promised_date) : !!r.done_at && istDate(new Date(r.done_at)) > r.promised_date);
    const actual = Number(r.actual);
    const quoted = r.per_hour ? Number(r.billable) : null;
    const overPct = quoted && actual > 0 ? ((actual - quoted) / quoted) * 100 : null;
    return {
      id: r.id,
      ticketId: r.ticket_id,
      ticketNo: r.ticket_no,
      company: r.company,
      service: r.service,
      deptCode: r.dept,
      status: r.status,
      ticketStage: r.stage,
      priority: r.priority,
      promisedDate: r.promised_date,
      hoursNeeded: r.hours_needed == null ? null : Number(r.hours_needed),
      plannedHours: Number(r.planned ?? 0),
      actualHours: actual,
      quotedHours: quoted,
      overPct,
      overQuoted: overPct != null && overPct > alert,
      plannedStart: r.first_start ? new Date(r.first_start) : null,
      plannedEnd: lastEnd,
      machines: r.machines ?? [],
      operator: r.operator,
      operatorId: r.operator_id,
      late,
      checkWorkDone: r.check_work_done && open,
    };
  });
  return list.filter((j) => (!f.late || j.late) && (!f.overQuoted || j.overQuoted));
}
export type JobRow = Awaited<ReturnType<typeof listJobs>>[number];

/** Machines for booking: the ones linked to the job's service first; all machines grouped by department. */
export async function getBookingOptions() {
  await connection();
  const [ms, links, depts, team, plan] = await Promise.all([
    db
      .select({ id: machines.id, name: machines.name, code: machines.code, deptCode: machines.deptCode, status: machines.status, runsNonstop: machines.runsNonstop, parallelJobs: machines.parallelJobs })
      .from(machines)
      .where(eq(machines.isActive, true))
      .orderBy(asc(machines.sortOrder), asc(machines.name)),
    db.select().from(machineServices),
    db.select({ code: departments.code, name: departments.name }).from(departments).orderBy(asc(departments.sortOrder)),
    db.select({ id: teamMembers.id, name: teamMembers.name }).from(teamMembers).where(eq(teamMembers.isActive, true)).orderBy(asc(teamMembers.sortOrder), asc(teamMembers.name)),
    getPlanningSettings(),
  ]);
  const s = plan.settings;
  return {
    machines: ms.map((m) => ({ ...m, serviceIds: links.filter((l) => l.machineId === m.id).map((l) => l.serviceId) })),
    departments: depts,
    team,
    /** The working-hours settings, so the form can work out the end live. */
    hours: { workingDays: s.workingDays, shiftStart: s.shiftStart, shiftEnd: s.shiftEnd, breakStart: s.breakStart, breakEnd: s.breakEnd, holidays: plan.holidays.map((h) => h.date) },
    holdDays: s.tentativeHoldDays,
  };
}
export type BookingOptions = Awaited<ReturnType<typeof getBookingOptions>>;

/** Everything the job panel shows. */
export async function getJobDetail(id: string) {
  await connection();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db
    .select({ job: jobs, ticket: tickets, operator: teamMembers.name })
    .from(jobs)
    .innerJoin(tickets, eq(tickets.id, jobs.ticketId))
    .leftJoin(teamMembers, eq(teamMembers.id, jobs.operatorId))
    .where(eq(jobs.id, id));
  if (!row) return null;
  const [item] = await db.execute<{ service_id: number | null; unit_type: string | null; custom: boolean; customer_id: string }>(sql`
    select qi.service_id, qi.unit_type, qi.is_custom_item as custom, t.customer_id from tickets t join quotation_items qi on qi.id = t.quotation_item_id where t.id = ${row.ticket.id}`).then((r) => r.rows);
  const [bookings, logs, events, fileRows, actual] = await Promise.all([
    db
      .select({ b: jobBookings, machine: machines.name, machineCode: machines.code, operator: teamMembers.name })
      .from(jobBookings)
      .innerJoin(machines, eq(machines.id, jobBookings.machineId))
      .leftJoin(teamMembers, eq(teamMembers.id, jobBookings.operatorId))
      .where(and(eq(jobBookings.jobId, id), isNull(jobBookings.cancelledAt)))
      .orderBy(asc(jobBookings.startAt)),
    db
      .select({ l: jobTimeLogs, operator: teamMembers.name, machine: machines.name })
      .from(jobTimeLogs)
      .leftJoin(teamMembers, eq(teamMembers.id, jobTimeLogs.operatorId))
      .leftJoin(machines, eq(machines.id, jobTimeLogs.machineId))
      .where(eq(jobTimeLogs.jobId, id))
      .orderBy(asc(jobTimeLogs.startedAt)),
    db.execute<{ id: number; type: string; message: string; created_by: string | null; created_at: string }>(sql`select id, type, message, created_by, created_at::text from job_events where job_id = ${id} order by created_at desc, id desc`).then((r) => r.rows),
    db.execute<{ id: string; file_name: string; size: number }>(sql`select f.id, f.file_name, f.size from job_files jf join files f on f.id = jf.file_id where jf.job_id = ${id} order by f.uploaded_at`).then((r) => r.rows),
    db.execute<{ h: string }>(sql`select ${ACTUAL_SQL} as h from jobs j where j.id = ${id}`).then((r) => Number(r.rows[0]?.h ?? 0)),
  ]);
  const perHour = !item?.custom && (item?.unit_type === "PER_HOUR" || item?.unit_type === "PER_HOUR_3_SAMPLES");
  const planned = bookings.reduce((a, b) => a + Number(b.b.hours), 0);
  return {
    job: row.job,
    operatorName: row.operator,
    ticket: {
      id: row.ticket.id,
      ticketNo: row.ticket.ticketNo,
      stage: row.ticket.stage,
      quotationId: row.ticket.quotationId,
      customerId: row.ticket.customerId,
      company: row.ticket.snapshot.companyName,
      service: row.ticket.snapshot.description,
      deptCode: row.ticket.snapshot.deptCode,
      quantityText: row.ticket.snapshot.quantityText,
      quoteNo: row.ticket.snapshot.quoteNo,
      notes: row.ticket.snapshot.notes,
      taxablePaise: Math.round(Number(row.ticket.taxableValue) * 100),
    },
    serviceId: item?.service_id ?? null,
    isCustomItem: !!item?.custom,
    perHour,
    quotedHours: perHour ? Number(row.ticket.snapshot.billableQty) : null,
    bookings: bookings.map((x) => ({ ...x.b, machine: x.machine, machineCode: x.machineCode, operator: x.operator })),
    plannedHours: planned,
    timeLogs: logs.map((x) => ({ ...x.l, operator: x.operator, machine: x.machine })),
    actualHours: actual,
    events: events.map((e) => ({ ...e, createdAt: new Date(e.created_at) })),
    files: fileRows,
  };
}
export type JobDetail = NonNullable<Awaited<ReturnType<typeof getJobDetail>>>;

// ---- timeline -----------------------------------------------------------------------------------------

export type TimelineView = "day" | "week" | "2w";
export interface TimelineFilters {
  view: TimelineView;
  date: string;
  dept?: string;
  machine?: string;
  operator?: string;
  customer?: string;
  late?: boolean;
  tentative?: boolean;
}

export async function timelineFiltersFromParams(sp: Record<string, string | string[] | undefined>): Promise<TimelineFilters> {
  await connection();
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const uuid = (v: string) => (/^[0-9a-f-]{36}$/i.test(v) ? v : undefined);
  const view = (["day", "week", "2w"] as const).find((v) => v === one("view")) ?? "week";
  const today = istDate(new Date());
  let date = /^\d{4}-\d{2}-\d{2}$/.test(one("date")) ? one("date") : today;
  if (view !== "day") date = weekStart(date); // weeks start on Monday
  return {
    view,
    date,
    dept: /^[A-Z]{2,6}$/.test(one("dept")) ? one("dept") : undefined,
    machine: uuid(one("machine")),
    operator: uuid(one("operator")),
    customer: uuid(one("customer")),
    late: one("late") === "1",
    tentative: one("tentative") === "1",
  };
}

export const VIEW_DAYS: Record<TimelineView, number> = { day: 1, week: 7, "2w": 14 };

/** Machines, bookings and blocked time in the window, and the jobs still to plan. */
export async function getTimeline(f: TimelineFilters) {
  await connection();
  const start = istAt(f.date, 0);
  const end = istAt(dayPlus(f.date, VIEW_DAYS[f.view]), 0);
  const today = istDate(new Date());
  const [[warnSet], ms, bookingRows, blocks, toPlan, options, customers] = await Promise.all([
    db.select({ pct: settings.overrunWarningPct }).from(settings).where(eq(settings.id, 1)),
    db.select().from(machines).where(eq(machines.isActive, true)).orderBy(asc(machines.sortOrder), asc(machines.name)),
    db.execute<{
      id: string; job_id: string; machine_id: string; start_at: string; end_at: string; hours: string; is_tentative: boolean; hold_until: string | null; note: string | null;
      ticket_no: string; company: string; service: string; status: JobStatusName; promised_date: string | null; operator_id: string | null; operator: string | null; customer_id: string; priority: string;
    }>(sql`
      select b.id, b.job_id, b.machine_id, b.start_at::text, b.end_at::text, b.hours, b.is_tentative, b.hold_until::text, b.note,
        t.ticket_no, t.snapshot->>'companyName' as company, t.snapshot->>'description' as service, j.status, j.promised_date::text,
        coalesce(b.operator_id, j.operator_id) as operator_id, tm.name as operator, t.customer_id, j.priority
      from job_bookings b join jobs j on j.id = b.job_id join tickets t on t.id = j.ticket_id
      left join team_members tm on tm.id = coalesce(b.operator_id, j.operator_id)
      where b.cancelled_at is null and b.start_at < ${end} and b.end_at > ${start}
      order by b.start_at`),
    db.select().from(machineBlocks).where(and(lt(machineBlocks.startAt, end), gt(machineBlocks.endAt, start))),
    db.execute<{ id: string; ticket_no: string; company: string; service: string; dept: string | null; priority: "NORMAL" | "URGENT"; promised_date: string | null; hours_needed: string | null; planned: string | null; stage: string }>(sql`
      select j.id, t.ticket_no, t.snapshot->>'companyName' as company, t.snapshot->>'description' as service, t.snapshot->>'deptCode' as dept, j.priority,
        j.promised_date::text, j.hours_needed, t.stage,
        (select sum(b.hours) from job_bookings b where b.job_id = j.id and b.cancelled_at is null) as planned
      from jobs j join tickets t on t.id = j.ticket_id
      where j.status = 'TO_PLAN' ${f.dept ? sql`and t.snapshot->>'deptCode' = ${f.dept}` : sql``}
      order by j.priority desc, coalesce(j.promised_date, '9999-12-31'), t.ticket_no`),
    getBookingOptions(),
    db.execute<{ id: string; name: string }>(sql`select distinct c.id, c.company_name as name from tickets t join customers c on c.id = t.customer_id join jobs j on j.ticket_id = t.id order by 2`),
  ]);
  const machineList = ms.filter((m) => (!f.dept || m.deptCode === f.dept) && (!f.machine || m.id === f.machine));
  const bookings = bookingRows.rows
    .map((b) => {
      const endAt = new Date(b.end_at);
      const open = !["DONE", "HANDED_OVER", "CANCELLED"].includes(b.status);
      return {
        id: b.id,
        jobId: b.job_id,
        machineId: b.machine_id,
        start: b.start_at,
        end: b.end_at,
        hours: Number(b.hours),
        tentative: b.is_tentative,
        holdExpired: b.is_tentative && !!b.hold_until && b.hold_until < today,
        holdUntil: b.hold_until,
        note: b.note,
        ticketNo: b.ticket_no,
        company: b.company,
        service: b.service,
        status: b.status,
        operator: b.operator,
        operatorId: b.operator_id,
        customerId: b.customer_id,
        urgent: b.priority === "URGENT",
        late: !!b.promised_date && open && (today > b.promised_date || istDate(endAt) > b.promised_date),
        overrun: b.status === "RUNNING" && new Date(b.start_at) <= new Date() && isOverrun({ start: new Date(b.start_at), end: endAt }, new Date(), warnSet?.pct ?? 50),
      };
    })
    .filter((b) => (!f.operator || b.operatorId === f.operator) && (!f.customer || b.customerId === f.customer) && (!f.late || b.late) && (!f.tentative || b.tentative));
  return {
    window: { start: start.toISOString(), end: end.toISOString(), days: VIEW_DAYS[f.view] },
    departments: options.departments,
    machines: machineList.map((m) => ({ id: m.id, name: m.name, code: m.code, deptCode: m.deptCode, status: m.status, runsNonstop: m.runsNonstop, parallelJobs: m.parallelJobs })),
    allMachines: ms.map((m) => ({ id: m.id, name: m.name })),
    bookings,
    blocks: blocks.map((b) => ({ id: b.id, machineId: b.machineId, type: b.type, start: b.startAt.toISOString(), end: b.endAt.toISOString(), note: b.note })),
    toPlan: toPlan.rows.map((j) => {
      const needed = j.hours_needed == null ? null : Number(j.hours_needed);
      return {
        id: j.id,
        ticketNo: j.ticket_no,
        company: j.company,
        service: j.service,
        deptCode: j.dept,
        urgent: j.priority === "URGENT",
        promisedDate: j.promised_date,
        late: !!j.promised_date && j.promised_date < today,
        hoursNeeded: needed,
        unplanned: needed == null ? null : Math.max(0, needed - Number(j.planned ?? 0)),
        waitingForPo: j.stage === "WAITING_PO",
      };
    }),
    options,
    customers: customers.rows,
  };
}
export type TimelineData = Awaited<ReturnType<typeof getTimeline>>;

/** For booking from the timeline: one job's details for the Book time form. */
export async function getBookJob(jobId: string) {
  await connection();
  const d = await getJobDetail(jobId);
  if (!d) return null;
  return {
    id: d.job.id,
    ticketNo: d.ticket.ticketNo,
    company: d.ticket.company,
    service: d.ticket.service,
    serviceId: d.serviceId,
    isCustomItem: d.isCustomItem,
    waitingForPo: d.ticket.stage === "WAITING_PO",
    promisedDate: d.job.promisedDate,
    operatorId: d.job.operatorId,
    unplannedHours: d.job.hoursNeeded != null ? Math.max(0, Number(d.job.hoursNeeded) - d.plannedHours) : 0,
  };
}

// ---- needs attention ----------------------------------------------------------------------------------

/** "Needs attention" (top of the Timeline): everything someone should act on now. */
export async function getNeedsAttention() {
  await connection();
  const now = new Date();
  const today = istDate(now);
  const [[set], late, holds, running, unplannedLate, clashes, broken] = await Promise.all([
    db.select({ pct: settings.overrunWarningPct }).from(settings).where(eq(settings.id, 1)),
    listJobs({ late: true }, 200),
    db.execute<{ booking_id: string; job_id: string; ticket_no: string; company: string; machine: string; hold_until: string; start_at: string }>(sql`
      select b.id as booking_id, b.job_id, t.ticket_no, t.snapshot->>'companyName' as company, m.name as machine, b.hold_until::text, b.start_at::text
      from job_bookings b join jobs j on j.id = b.job_id join tickets t on t.id = j.ticket_id join machines m on m.id = b.machine_id
      where b.cancelled_at is null and b.is_tentative and b.hold_until < ${today} and j.status not in ('CANCELLED', 'DONE', 'HANDED_OVER')
      order by b.hold_until`),
    db.execute<{ job_id: string; ticket_no: string; company: string; machine: string | null; started_at: string; booked_start: string | null; booked_end: string | null }>(sql`
      select j.id as job_id, t.ticket_no, t.snapshot->>'companyName' as company, m.name as machine,
        (select min(l.started_at) from job_time_logs l where l.job_id = j.id)::text as started_at,
        b.start_at::text as booked_start, b.end_at::text as booked_end
      from jobs j join tickets t on t.id = j.ticket_id
      left join lateral (select * from job_bookings b where b.job_id = j.id and b.cancelled_at is null order by b.end_at desc limit 1) b on true
      left join machines m on m.id = b.machine_id
      where j.status = 'RUNNING'`),
    db.execute<{ id: string; ticket_no: string; company: string; promised_date: string }>(sql`
      select j.id, t.ticket_no, t.snapshot->>'companyName' as company, j.promised_date::text
      from jobs j join tickets t on t.id = j.ticket_id
      where j.status = 'TO_PLAN' and j.promised_date < ${today} order by j.promised_date`),
    bookingsClashingWithBlocks(db, now),
    listOverdueBreakdowns(),
  ]);
  const pct = set?.pct ?? 50;
  const overruns = running.rows
    .filter((r) => r.booked_start && r.booked_end)
    .map((r) => {
      const bs = new Date(r.booked_start!);
      const be = new Date(r.booked_end!);
      const limit = be.getTime() + ((be.getTime() - bs.getTime()) * pct) / 100;
      return { jobId: r.job_id, ticketNo: r.ticket_no, company: r.company, machine: r.machine, startedAt: r.started_at ? new Date(r.started_at) : bs, bookedEnd: be, over: now.getTime() > limit };
    })
    .filter((r) => r.over);
  return {
    late: late.filter((j) => j.status !== "TO_PLAN" || !j.promisedDate || j.promisedDate >= today),
    expiredHolds: holds.rows.map((h) => ({ bookingId: h.booking_id, jobId: h.job_id, ticketNo: h.ticket_no, company: h.company, machine: h.machine, holdUntil: h.hold_until, start: new Date(h.start_at) })),
    overruns,
    unplannedLate: unplannedLate.rows,
    clashes,
    broken,
  };
}
export type NeedsAttention = Awaited<ReturnType<typeof getNeedsAttention>>;

// ---- today (operators) ----------------------------------------------------------------------------------

/**
 * Today's cards for everyone (the screen filters by "Who's working?"): bookings today, running
 * and on-hold jobs, and jobs done in the last 7 days that aren't handed over yet.
 */
export async function getToday() {
  await connection();
  const now = new Date();
  const today = istDate(now);
  const dayStart = istAt(today, 0);
  const dayEnd = istAt(dayPlus(today, 1), 0);
  const [[set], team, rows] = await Promise.all([
    db.select().from(settings).where(eq(settings.id, 1)),
    db.select({ id: teamMembers.id, name: teamMembers.name }).from(teamMembers).where(eq(teamMembers.isActive, true)).orderBy(asc(teamMembers.sortOrder), asc(teamMembers.name)),
    db.execute<{
      job_id: string; status: JobStatusName; ticket_id: string; ticket_no: string; company: string; service: string; instructions: string | null; hold_reason: string | null;
      job_operator: string | null; booking_id: string | null; booking_operator: string | null; machine: string | null; start_at: string | null; end_at: string | null;
      log_operator: string | null; log_started: string | null; first_started: string | null; actual: string; done_at: string | null; done_note: string | null;
      contact: string | null; phone: string | null; per_hour: boolean; billable: string; has_list: boolean; recorded: boolean;
    }>(sql`
      with day_bookings as (
        select b.* from job_bookings b where b.cancelled_at is null and b.start_at < ${dayEnd} and b.end_at > ${dayStart}
      ), picked as (
        select j.id from jobs j where j.status in ('RUNNING', 'ON_HOLD')
        union select db.job_id from day_bookings db
        union select j.id from jobs j where j.status = 'DONE' and j.done_at > ${new Date(now.getTime() - 7 * 86_400_000)}
      )
      select j.id as job_id, j.status, t.id as ticket_id, t.ticket_no, t.snapshot->>'companyName' as company, t.snapshot->>'description' as service,
        j.instructions, j.hold_reason, j.operator_id as job_operator,
        b.id as booking_id, b.operator_id as booking_operator, m.name as machine, b.start_at::text, b.end_at::text,
        l.operator_id as log_operator, l.started_at::text as log_started,
        (select min(x.started_at)::text from job_time_logs x where x.job_id = j.id) as first_started,
        ${ACTUAL_SQL} as actual, j.done_at::text, j.done_note,
        c.poc_name as contact, c.poc_phone as phone,
        (qi.unit_type in ('PER_HOUR', 'PER_HOUR_3_SAMPLES') and not qi.is_custom_item) as per_hour, qi.billable_qty as billable,
        exists (select 1 from inv_service_materials sm where sm.service_id = qi.service_id) as has_list,
        exists (select 1 from inv_documents d where d.ticket_id = t.id and d.type = 'OUT' and d.reverses_doc_id is null and d.reversed_by_doc_id is null) as recorded
      from picked p
      join jobs j on j.id = p.id
      join tickets t on t.id = j.ticket_id
      join quotation_items qi on qi.id = t.quotation_item_id
      join customers c on c.id = t.customer_id
      left join job_time_logs l on l.job_id = j.id and l.ended_at is null
      left join lateral (
        select * from job_bookings b2 where b2.job_id = j.id and b2.cancelled_at is null
        order by (b2.start_at < ${dayEnd} and b2.end_at > ${dayStart}) desc, abs(extract(epoch from (b2.start_at - ${now}))) limit 1
      ) b on true
      left join machines m on m.id = b.machine_id
      where j.status <> 'CANCELLED'
      order by coalesce(b.start_at, now())`),
  ]);
  const warn = set?.overrunWarningPct ?? 50;
  const alert = set?.actualVsQuotedAlertPct ?? 10;
  const cards = rows.rows.map((r) => {
    const booked = r.start_at && r.end_at ? { start: new Date(r.start_at), end: new Date(r.end_at) } : null;
    const actual = Number(r.actual);
    const quoted = r.per_hour ? Number(r.billable) : null;
    return {
      jobId: r.job_id,
      status: r.status,
      ticketId: r.ticket_id,
      ticketNo: r.ticket_no,
      company: r.company,
      service: r.service,
      instructions: r.instructions,
      holdReason: r.hold_reason,
      machine: r.machine,
      start: r.start_at,
      end: r.end_at,
      /** Who it's for: the booking's operator, the job's operator, or whoever is running it. */
      operatorIds: [...new Set([r.booking_operator, r.job_operator, r.log_operator].filter((x): x is string => !!x))],
      runningSince: r.log_started,
      firstStarted: r.first_started,
      overrun: r.status === "RUNNING" && isOverrun(booked, now, warn),
      actualHours: actual,
      quotedHours: quoted,
      vsQuoted: quotedVsActual(quoted, actual, alert),
      doneAt: r.done_at,
      doneNote: r.done_note,
      contact: r.contact,
      phone: r.phone,
      materialsMissing: r.has_list && !r.recorded,
    };
  });
  return { today, team, cards, readyTemplate: set?.readyWhatsappTemplate ?? "", orgName: set?.orgName ?? "", warnPct: warn };
}
export type TodayData = Awaited<ReturnType<typeof getToday>>;
export type TodayCard = TodayData["cards"][number];

/** The 4 Planning cards on the home page. */
export async function getPlanningHomeStats() {
  await connection();
  const now = new Date();
  const [counts, late, blocked] = await Promise.all([
    db.execute<{ to_plan: string; running: string }>(sql`select count(*) filter (where status = 'TO_PLAN') as to_plan, count(*) filter (where status = 'RUNNING') as running from jobs`),
    listJobs({ late: true }, 1000),
    db.execute<{ n: string }>(sql`
      select count(*) as n from machines m
      where m.is_active and (m.status in ('BREAKDOWN', 'MAINTENANCE') or exists (select 1 from machine_blocks b where b.machine_id = m.id and b.start_at <= ${now} and b.end_at > ${now}))`),
  ]);
  return { toPlan: Number(counts.rows[0].to_plan), running: Number(counts.rows[0].running), late: late.length, notAvailable: Number(blocked.rows[0].n) };
}

/** Internal-use stock records from the last 60 days, so a maintenance block can point to the spares used. */
export async function getRecentInternalUse() {
  await connection();
  const rows = await db.execute<{ id: string; doc_no: string; doc_date: string; purpose: string; items: string | null }>(sql`
    select d.id, d.doc_no, d.doc_date::text, p.name as purpose,
      (select string_agg(i.name, ', ' order by i.name) from inv_movements m join inv_items i on i.id = m.item_id where m.document_id = d.id) as items
    from inv_documents d join inv_purposes p on p.id = d.purpose_id
    where d.type = 'OUT' and d.reversed_by_doc_id is null and d.reverses_doc_id is null and d.doc_date > current_date - 60
    order by d.doc_date desc, d.seq desc limit 50`);
  return rows.rows.map((r) => ({ id: r.id, label: `${r.doc_no} · ${r.purpose}${r.items ? `: ${r.items}` : ""}` }));
}
