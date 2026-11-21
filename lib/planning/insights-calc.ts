/** Planning Insights maths (brief section 11). Pure and unit-tested. */
import { istAt, workingMinutesBetween, type Span, type WorkPattern } from "./hours";

/** Every month (YYYY-MM) from one date to another. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const endY = Number(to.slice(0, 4));
  const endM = Number(to.slice(5, 7));
  while (y < endY || (y === endY && m <= endM)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) [y, m] = [y + 1, 1];
  }
  return out;
}

/** The part of a month inside the date range, as instants (India midnight to India midnight). */
export function monthWindowIn(month: string, range: Span): Span | null {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const start = new Date(Math.max(istAt(`${month}-01`, 0).getTime(), range.start.getTime()));
  const end = new Date(Math.min(istAt(next, 0).getTime(), range.end.getTime()));
  return end > start ? { start, end } : null;
}

/** Working hours of a span inside a window (24 h a day for day-and-night machines). */
export function workingHoursIn(s: Span, w: Span, pattern: WorkPattern, nonstop: boolean): number {
  const start = new Date(Math.max(s.start.getTime(), w.start.getTime()));
  const end = new Date(Math.min(s.end.getTime(), w.end.getTime()));
  return end > start ? workingMinutesBetween(start, end, pattern, nonstop) / 60 : 0;
}

/** Working hours in a normal working day: shift minus break (8.5 for 09:00-18:00 with 30 min break). */
export function hoursPerDay(p: WorkPattern): number {
  const shift = Math.max(0, p.shiftEnd - p.shiftStart);
  const brk = p.breakStart != null && p.breakEnd != null ? Math.max(0, Math.min(p.breakEnd, p.shiftEnd) - Math.max(p.breakStart, p.shiftStart)) : 0;
  return Math.max(0, shift - brk) / 60;
}

/**
 * What a department's machines can do in one working day: each machine's day (24 h for
 * day-and-night machines) times "jobs at the same time".
 */
export function deptDayCapacity(machines: { runsNonstop: boolean; parallelJobs: number }[], dayHours: number): number {
  return machines.reduce((a, m) => a + (m.runsNonstop ? 24 : dayHours) * Math.max(1, m.parallelJobs), 0);
}

/** "about X working days": 1 decimal under 10, whole days above. null when nothing can do the work. */
export function workingDays(hours: number, capacityPerDay: number): number | null {
  if (!(capacityPerDay > 0)) return null;
  const d = hours / capacityPerDay;
  return d < 10 ? Math.round(d * 10) / 10 : Math.round(d);
}

/** "₹41,000": rounded to ₹1,000 from ₹10,000, to ₹100 below that (whole paise in, paise out). */
export function aboutPaise(paise: number): number {
  const step = paise >= 10_000_00 ? 1000_00 : 100_00;
  return Math.round(paise / step) * step;
}

/** Value of the hours worked beyond the quote, at the customer's hourly rate (whole paise). */
export function extraValuePaise(quoted: number, actual: number, ratePaise: number): number {
  return Math.max(0, Math.round((actual - quoted) * ratePaise));
}

export interface DoneJob {
  dept: string;
  promised: string;
  /** India date it was done. */
  done: string;
}

/** % of jobs done by their promised date, per department per month done, and overall per month. */
export function onTimeTable(jobs: DoneJob[], months: string[]) {
  const cell = () => ({ done: 0, onTime: 0 });
  const byDept = new Map<string, Map<string, { done: number; onTime: number }>>();
  const total = new Map(months.map((m) => [m, cell()]));
  for (const j of jobs) {
    const m = j.done.slice(0, 7);
    if (!total.has(m)) continue;
    const ok = j.done <= j.promised ? 1 : 0;
    const row = byDept.get(j.dept) ?? new Map(months.map((x) => [x, cell()]));
    byDept.set(j.dept, row);
    for (const c of [row.get(m)!, total.get(m)!]) {
      c.done += 1;
      c.onTime += ok;
    }
  }
  const pct = (c: { done: number; onTime: number }) => (c.done ? (c.onTime / c.done) * 100 : null);
  const sum = (cells: Iterable<{ done: number; onTime: number }>) => [...cells].reduce((a, c) => ({ done: a.done + c.done, onTime: a.onTime + c.onTime }), cell());
  return {
    months: months.map((m) => ({
      month: m,
      ...total.get(m)!,
      pct: pct(total.get(m)!),
    })),
    depts: [...byDept.entries()].map(([dept, row]) => ({
      dept,
      cells: months.map((m) => ({
        month: m,
        ...row.get(m)!,
        pct: pct(row.get(m)!),
      })),
      overall: { ...sum(row.values()), pct: pct(sum(row.values())) },
    })),
    overall: { ...sum(total.values()), pct: pct(sum(total.values())) },
  };
}

/** Days between two India dates (b - a). */
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/**
 * Splits each job's value over the machines it ran on, by the share of its running hours on each.
 * Returns per machine: jobs, hours run, value (paise).
 */
export function earningsByMachine(jobs: { valuePaise: number; hours: Map<string, number> }[]) {
  const out = new Map<string, { jobs: number; hours: number; valuePaise: number }>();
  for (const j of jobs) {
    const total = [...j.hours.values()].reduce((a, h) => a + h, 0);
    if (!(total > 0)) continue;
    for (const [machineId, h] of j.hours) {
      if (!(h > 0)) continue;
      const r = out.get(machineId) ?? { jobs: 0, hours: 0, valuePaise: 0 };
      r.jobs += 1;
      r.hours += h;
      r.valuePaise += (j.valuePaise * h) / total;
      out.set(machineId, r);
    }
  }
  for (const r of out.values()) r.valuePaise = Math.round(r.valuePaise);
  return out;
}
