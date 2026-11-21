/**
 * Planning Insights (brief section 11): read-only queries for decisions. Money is whole paise,
 * hours are decimal hours, dates are India dates.
 */
import "server-only";
import { sql } from "drizzle-orm";
import { connection } from "next/server";
import { db } from "@/db";
import { dayPlus, istAt, istDate, type Span } from "@/lib/planning/hours";
import {
  aboutPaise,
  daysBetween,
  deptDayCapacity,
  earningsByMachine,
  extraValuePaise,
  hoursPerDay,
  monthsBetween,
  monthWindowIn,
  onTimeTable,
  workingDays,
  workingHoursIn,
} from "@/lib/planning/insights-calc";
import { machineUse } from "@/lib/planning/use";
import { quotedVsActual } from "@/lib/planning/work";
import { getPlanningSettings } from "@/lib/planning-data";

export interface PlanningInsightFilters {
  from: string;
  to: string;
  dept: string | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** A machine is "very busy" from this booked % over the next 2 weeks. */
export const BUSY_PCT = 85;
/** ...and "rarely used" below this actual %. */
export const QUIET_PCT = 10;
/** Earnings per hour are shown only for machines that ran at least this long (a few minutes give silly numbers). */
export const MIN_EARNING_HOURS = 1;

/** Default: this month (1st to the last day). */
export async function planningInsightFiltersFromParams(sp: Record<string, string | string[] | undefined>): Promise<PlanningInsightFilters> {
  await connection();
  const today = istDate(new Date());
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const first = `${today.slice(0, 7)}-01`;
  const last = dayPlus(monthsAfter(first, 1), -1);
  let from = DATE_RE.test(one("from")) ? one("from") : first;
  let to = DATE_RE.test(one("to")) ? one("to") : last;
  if (from > to) [from, to] = [to, from];
  const dept = /^[A-Z]{2,6}$/.test(one("dept")) ? one("dept") : null;
  return { from, to, dept };
}

/** The 1st of the month n months after a "YYYY-MM-01" date. */
export function monthsAfter(first: string, n: number): string {
  const d = new Date(Date.UTC(Number(first.slice(0, 4)), Number(first.slice(5, 7)) - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}

const BLOCK_TYPES = ["MAINTENANCE", "CALIBRATION", "BREAKDOWN", "INTERNAL", "OTHER"] as const;
export type BlockTypeName = (typeof BLOCK_TYPES)[number];
export const BLOCK_TYPE_NAMES: Record<BlockTypeName, string> = {
  MAINTENANCE: "Maintenance",
  CALIBRATION: "Calibration",
  BREAKDOWN: "Breakdown",
  INTERNAL: "Internal work",
  OTHER: "Other",
};

const DONE = sql`j.status in ('DONE', 'HANDED_OVER')`;

export async function getPlanningInsights(f: PlanningInsightFilters) {
  await connection();
  const now = new Date();
  const today = istDate(now);
  const range: Span = {
    start: istAt(f.from, 0),
    end: istAt(dayPlus(f.to, 1), 0),
  };
  const next2w: Span = { start: now, end: istAt(dayPlus(today, 14), 0) };
  const months = monthsBetween(f.from, f.to);
  const deptJob = f.dept ? sql`and coalesce(t.snapshot->>'deptCode', '') = ${f.dept}` : sql``;
  const doneInRange = sql`${DONE} and j.done_at >= ${range.start} and j.done_at < ${range.end}`;

  const [plan, depts, machineRows, bookingRows, logRows, blockRows, openJobs, futureBookings, perHourJobs, doneJobs, overdueOpen, earningRows] = await Promise.all([
    getPlanningSettings(),
    db.execute<{ code: string; name: string }>(sql`select code, name from departments order by sort_order`).then((r) => r.rows),
    db
      .execute<{
        id: string;
        code: string;
        name: string;
        dept_code: string | null;
        runs_nonstop: boolean;
        parallel_jobs: number;
        status: string;
      }>(sql`select id, code, name, dept_code, runs_nonstop, parallel_jobs, status from machines where is_active ${f.dept ? sql`and dept_code = ${f.dept}` : sql``} order by sort_order, code`)
      .then((r) => r.rows),
    // Bookings in the range or the next 2 weeks.
    db
      .execute<{ machine_id: string; start_at: string; end_at: string }>(
        sql`select machine_id, start_at::text, end_at::text from job_bookings where cancelled_at is null
          and start_at < ${new Date(Math.max(range.end.getTime(), next2w.end.getTime()))} and end_at > ${new Date(Math.min(range.start.getTime(), next2w.start.getTime()))}`,
      )
      .then((r) => r.rows),
    db
      .execute<{
        machine_id: string;
        started_at: string;
        ended_at: string | null;
      }>(sql`select machine_id, started_at::text, ended_at::text from job_time_logs where started_at < ${range.end} and coalesce(ended_at, now()) > ${range.start}`)
      .then((r) => r.rows),
    db
      .execute<{
        machine_id: string;
        type: BlockTypeName;
        start_at: string;
        end_at: string;
      }>(sql`select machine_id, type, start_at::text, end_at::text from machine_blocks where start_at < ${range.end} and end_at > ${range.start}`)
      .then((r) => r.rows),
    // Open jobs: hours still to book.
    db
      .execute<{
        dept: string | null;
        hours_needed: string | null;
        booked: string | null;
      }>(
        sql`select t.snapshot->>'deptCode' as dept, j.hours_needed,
          (select sum(b.hours) from job_bookings b where b.job_id = j.id and b.cancelled_at is null) as booked
        from jobs j join tickets t on t.id = j.ticket_id
        where j.status in ('TO_PLAN', 'PLANNED', 'RUNNING', 'ON_HOLD') ${deptJob}`,
      )
      .then((r) => r.rows),
    // Booked time still to come on open jobs.
    db
      .execute<{
        dept: string | null;
        start_at: string;
        end_at: string;
        runs_nonstop: boolean;
      }>(
        sql`select t.snapshot->>'deptCode' as dept, b.start_at::text, b.end_at::text, m.runs_nonstop
        from job_bookings b join jobs j on j.id = b.job_id join tickets t on t.id = j.ticket_id join machines m on m.id = b.machine_id
        where b.cancelled_at is null and b.end_at > ${now} and j.status in ('TO_PLAN', 'PLANNED', 'RUNNING', 'ON_HOLD') ${deptJob}`,
      )
      .then((r) => r.rows),
    // Per-hour jobs done in the range, with hours actually run.
    db
      .execute<{
        job_id: string;
        ticket_id: string;
        ticket_no: string;
        company: string;
        service: string;
        dept: string | null;
        billable: string;
        rate: string;
        done_at: string;
        actual: string;
      }>(
        sql`select j.id as job_id, t.id as ticket_id, t.ticket_no, t.snapshot->>'companyName' as company, t.snapshot->>'description' as service, t.snapshot->>'deptCode' as dept,
          qi.billable_qty as billable, qi.final_rate as rate, j.done_at::text,
          (select coalesce(sum(extract(epoch from (coalesce(l.ended_at, now()) - l.started_at))), 0) / 3600 from job_time_logs l where l.job_id = j.id) as actual
        from jobs j join tickets t on t.id = j.ticket_id join quotation_items qi on qi.id = t.quotation_item_id
        where ${doneInRange} and qi.unit_type in ('PER_HOUR', 'PER_HOUR_3_SAMPLES') and not qi.is_custom_item ${deptJob}`,
      )
      .then((r) => r.rows),
    // Jobs done in the range that had a promised date.
    db
      .execute<{
        job_id: string;
        ticket_id: string;
        ticket_no: string;
        company: string;
        service: string;
        dept: string | null;
        promised: string;
        done_at: string;
      }>(
        sql`select j.id as job_id, t.id as ticket_id, t.ticket_no, t.snapshot->>'companyName' as company, t.snapshot->>'description' as service, t.snapshot->>'deptCode' as dept,
          j.promised_date::text as promised, j.done_at::text
        from jobs j join tickets t on t.id = j.ticket_id
        where ${doneInRange} and j.promised_date is not null ${deptJob}`,
      )
      .then((r) => r.rows),
    // Open jobs whose promised date (in the range) has passed.
    db
      .execute<{
        job_id: string;
        ticket_id: string;
        ticket_no: string;
        company: string;
        service: string;
        dept: string | null;
        promised: string;
      }>(
        sql`select j.id as job_id, t.id as ticket_id, t.ticket_no, t.snapshot->>'companyName' as company, t.snapshot->>'description' as service, t.snapshot->>'deptCode' as dept,
          j.promised_date::text as promised
        from jobs j join tickets t on t.id = j.ticket_id
        where j.status in ('TO_PLAN', 'PLANNED', 'RUNNING', 'ON_HOLD') and j.promised_date < ${today} and j.promised_date between ${f.from} and ${f.to} ${deptJob}
        order by j.promised_date`,
      )
      .then((r) => r.rows),
    // Jobs done in the range: their value before GST and hours run on each machine.
    db
      .execute<{
        job_id: string;
        value: string;
        machine_id: string;
        hours: string;
      }>(
        sql`select j.id as job_id, round(t.taxable_value * 100)::bigint as value, l.machine_id,
          sum(extract(epoch from (coalesce(l.ended_at, now()) - l.started_at))) / 3600 as hours
        from jobs j join tickets t on t.id = j.ticket_id join job_time_logs l on l.job_id = j.id
        where ${doneInRange}
        group by j.id, t.taxable_value, l.machine_id`,
      )
      .then((r) => r.rows),
  ]);

  const { pattern, settings: s } = plan;
  const alertPct = s.actualVsQuotedAlertPct;
  const deptName = new Map(depts.map((d) => [d.code, d.name]));
  const span = (a: string, b: string | null): Span => ({
    start: new Date(a),
    end: b ? new Date(b) : now,
  });
  const byMachine = <T extends { machine_id: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(r.machine_id, [...(m.get(r.machine_id) ?? []), r]);
    return m;
  };
  const bookingsBy = byMachine(bookingRows);
  const logsBy = byMachine(logRows);
  const blocksBy = byMachine(blockRows);

  // 1. Machine use %.
  const use = machineRows
    .map((m) => {
      const blocks = (blocksBy.get(m.id) ?? []).map((b) => span(b.start_at, b.end_at));
      const bookings = (bookingsBy.get(m.id) ?? []).map((b) => span(b.start_at, b.end_at));
      const running = (logsBy.get(m.id) ?? []).map((l) => span(l.started_at, l.ended_at));
      const base = {
        pattern,
        nonstop: m.runs_nonstop,
        parallelJobs: m.parallel_jobs,
        blocks,
        bookings,
      };
      const inRange = machineUse({ ...base, window: range, running });
      const ahead = machineUse({ ...base, window: next2w });
      return {
        id: m.id,
        code: m.code,
        name: m.name,
        deptCode: m.dept_code,
        ...inRange,
        nextBookedPct: ahead.bookedPct,
      };
    })
    .sort((a, b) => (b.bookedPct ?? -1) - (a.bookedPct ?? -1) || a.name.localeCompare(b.name));
  const busy = use.filter((m) => (m.nextBookedPct ?? 0) >= BUSY_PCT).sort((a, b) => b.nextBookedPct! - a.nextBookedPct!);
  const quiet = use.filter((m) => m.availableHours > 0 && (m.actualPct ?? 0) < QUIET_PCT && range.start < now);

  // 2. Work waiting per department.
  const dayHours = hoursPerDay(pattern);
  const waitingMap = new Map<string, { toBook: number; booked: number; noTime: number }>();
  const w = (dept: string | null) => {
    const k = dept ?? "OTHER";
    if (!waitingMap.has(k)) waitingMap.set(k, { toBook: 0, booked: 0, noTime: 0 });
    return waitingMap.get(k)!;
  };
  for (const j of openJobs) {
    const booked = Number(j.booked ?? 0);
    if (j.hours_needed == null) {
      if (!booked) w(j.dept).noTime += 1;
      continue;
    }
    w(j.dept).toBook += Math.max(0, Number(j.hours_needed) - booked);
  }
  for (const b of futureBookings) w(b.dept).booked += workingHoursIn(span(b.start_at, b.end_at), { start: now, end: new Date(b.end_at) }, pattern, b.runs_nonstop);
  const waiting = depts
    .filter((d) => !f.dept || d.code === f.dept)
    .map((d) => {
      const v = waitingMap.get(d.code) ?? { toBook: 0, booked: 0, noTime: 0 };
      const capacity = deptDayCapacity(
        machineRows
          .filter((m) => m.dept_code === d.code && m.status !== "INACTIVE")
          .map((m) => ({
            runsNonstop: m.runs_nonstop,
            parallelJobs: m.parallel_jobs,
          })),
        dayHours,
      );
      const hours = v.toBook + v.booked;
      return {
        deptCode: d.code,
        name: d.name,
        toBookHours: v.toBook,
        bookedHours: v.booked,
        hours,
        noTimeJobs: v.noTime,
        capacityPerDay: capacity,
        days: workingDays(hours, capacity),
      };
    })
    .sort((a, b) => (b.days ?? 0) - (a.days ?? 0) || b.hours - a.hours);

  // 3. Quoted vs actual hours.
  const overQuoted = perHourJobs
    .map((j) => {
      const quoted = Number(j.billable);
      const actual = Number(j.actual);
      const ratePaise = Math.round(Number(j.rate) * 100);
      const q = quotedVsActual(quoted, actual, alertPct);
      return {
        jobId: j.job_id,
        ticketId: j.ticket_id,
        ticketNo: j.ticket_no,
        company: j.company,
        service: j.service,
        deptCode: j.dept,
        doneDate: istDate(new Date(j.done_at)),
        quotedHours: quoted,
        actualHours: actual,
        extraHours: actual - quoted,
        overPct: q.pct,
        flagged: q.flagged,
        ratePaise,
        extraPaise: extraValuePaise(quoted, actual, ratePaise),
      };
    })
    .filter((j) => j.actualHours > 0);
  const flagged = overQuoted.filter((j) => j.flagged).sort((a, b) => b.extraPaise - a.extraPaise);
  const extraHours = flagged.reduce((a, j) => a + j.extraHours, 0);
  const extraPaise = flagged.reduce((a, j) => a + j.extraPaise, 0);

  // 4. On-time delivery.
  const done = doneJobs.map((j) => ({
    ...j,
    done: istDate(new Date(j.done_at)),
    dept: j.dept ?? "OTHER",
  }));
  const onTime = onTimeTable(done, months);
  const lateDone = done
    .filter((j) => j.done > j.promised)
    .map((j) => ({
      jobId: j.job_id,
      ticketId: j.ticket_id,
      ticketNo: j.ticket_no,
      company: j.company,
      service: j.service,
      deptCode: j.dept,
      promised: j.promised,
      done: j.done as string | null,
      daysLate: daysBetween(j.promised, j.done),
    }))
    .sort((a, b) => b.daysLate - a.daysLate);
  const lateOpen = overdueOpen.map((j) => ({
    jobId: j.job_id,
    ticketId: j.ticket_id,
    ticketNo: j.ticket_no,
    company: j.company,
    service: j.service,
    deptCode: j.dept ?? "OTHER",
    promised: j.promised,
    done: null as string | null,
    daysLate: daysBetween(j.promised, today),
  }));

  // 5. Machine not available: working hours blocked, by type, per machine per month.
  const machineById = new Map(machineRows.map((m) => [m.id, m]));
  const blockedRows: {
    machineId: string;
    name: string;
    month: string;
    hours: Record<BlockTypeName, number>;
    total: number;
  }[] = [];
  const blockedByMonth = months.map(
    (month) =>
      ({ month, ...Object.fromEntries(BLOCK_TYPES.map((t) => [t, 0])) }) as {
        month: string;
      } & Record<BlockTypeName, number>,
  );
  for (const m of machineRows) {
    const list = blocksBy.get(m.id) ?? [];
    if (!list.length) continue;
    months.forEach((month, i) => {
      const win = monthWindowIn(month, range);
      if (!win) return;
      const hours = Object.fromEntries(BLOCK_TYPES.map((t) => [t, 0])) as Record<BlockTypeName, number>;
      for (const b of list) hours[b.type] += workingHoursIn(span(b.start_at, b.end_at), win, pattern, m.runs_nonstop);
      const total = BLOCK_TYPES.reduce((a, t) => a + hours[t], 0);
      if (total <= 0) return;
      blockedRows.push({ machineId: m.id, name: m.name, month, hours, total });
      for (const t of BLOCK_TYPES) blockedByMonth[i][t] += hours[t];
    });
  }
  const blockTypesUsed = BLOCK_TYPES.filter((t) => blockedRows.some((r) => r.hours[t] > 0));

  // 6. Earnings per machine hour.
  const jobsHours = new Map<string, { valuePaise: number; hours: Map<string, number> }>();
  for (const r of earningRows) {
    const j = jobsHours.get(r.job_id) ?? {
      valuePaise: Number(r.value),
      hours: new Map<string, number>(),
    };
    j.hours.set(r.machine_id, Number(r.hours));
    jobsHours.set(r.job_id, j);
  }
  const earnMap = earningsByMachine([...jobsHours.values()]);
  const earnings = [...earnMap.entries()]
    .filter(([id, e]) => machineById.has(id) && e.hours >= MIN_EARNING_HOURS)
    .map(([id, e]) => ({
      machineId: id,
      name: machineById.get(id)!.name,
      deptCode: machineById.get(id)!.dept_code,
      ...e,
      perHourPaise: e.hours > 0 ? Math.round(e.valuePaise / e.hours) : 0,
    }))
    .sort((a, b) => b.perHourPaise - a.perHourPaise);

  return {
    departments: depts,
    deptName: Object.fromEntries(deptName),
    alertPct,
    use,
    busy: busy.map((m) => ({ name: m.name, pct: m.nextBookedPct! })),
    quiet: quiet.map((m) => ({ name: m.name, pct: m.actualPct ?? 0 })),
    waiting,
    quoted: {
      jobs: overQuoted.length,
      flagged,
      extraHours,
      extraPaise,
      aboutPaise: aboutPaise(extraPaise),
    },
    onTime: { ...onTime, late: [...lateDone, ...lateOpen] },
    blocked: {
      rows: blockedRows,
      byMonth: blockedByMonth,
      types: blockTypesUsed,
    },
    earnings,
  };
}
export type PlanningInsights = Awaited<ReturnType<typeof getPlanningInsights>>;
