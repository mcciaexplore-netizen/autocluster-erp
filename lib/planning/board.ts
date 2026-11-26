/**
 * Department board drawing rules (pure, India time): where each booking and blocked time sits in a
 * machine's week (Mon-Sun columns, minutes down the side), which hours a machine shows, the shaded
 * non-working time, and hours booked per day. Used by the board, the machine page and the tests.
 */
import { dayPlus, istAt, type WorkPattern } from "./hours";

const DAY = 1440;

/** One piece of a booking or block inside one day: day 0 = Monday; minutes from India midnight. */
export interface DaySegment {
  day: number;
  startMin: number;
  endMin: number;
}

/**
 * Splits [start, end) into the days of the week starting `weekFrom` (a Monday, "YYYY-MM-DD"). A booking
 * past midnight continues in the next day's column; parts outside the week are left out.
 */
export function daySegments(start: Date | string, end: Date | string, weekFrom: string): DaySegment[] {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  const out: DaySegment[] = [];
  for (let d = 0; d < 7; d++) {
    const dayStart = istAt(dayPlus(weekFrom, d), 0).getTime();
    const dayEnd = dayStart + DAY * 60_000;
    const a = Math.max(s, dayStart);
    const b = Math.min(e, dayEnd);
    if (b > a) out.push({ day: d, startMin: Math.round((a - dayStart) / 60_000), endMin: Math.round((b - dayStart) / 60_000) });
  }
  return out;
}

/** The dates of the week, Monday first. */
export const weekDates = (weekFrom: string) => Array.from({ length: 7 }, (_, d) => dayPlus(weekFrom, d));

/**
 * The hours a machine's calendar shows (in minutes, whole hours): day-and-night machines and the
 * "Show full 24 hours" switch show 00:00-24:00; machines that need an operator show their working
 * hours plus 1 hour either side, widened to include any booking or block that falls outside them.
 */
export function visibleRange(machine: { runsNonstop: boolean }, pattern: WorkPattern, full24: boolean, segments: DaySegment[] = []): { from: number; to: number } {
  if (full24 || machine.runsNonstop) return { from: 0, to: DAY };
  let from = Math.max(0, pattern.shiftStart - 60);
  let to = Math.min(DAY, pattern.shiftEnd + 60);
  for (const g of segments) {
    from = Math.min(from, g.startMin);
    to = Math.max(to, g.endMin);
  }
  return { from: Math.floor(from / 60) * 60, to: Math.min(DAY, Math.ceil(to / 60) * 60) };
}

/** Hour labels every 2 hours inside the range (e.g. 08:00, 10:00 ...). */
export function hourLabels(range: { from: number; to: number }): number[] {
  const first = Math.ceil(range.from / 120) * 120;
  const out: number[] = [];
  for (let m = first; m < range.to; m += 120) out.push(m);
  return out;
}

/**
 * Shaded time in one day for a machine: for machines that need an operator, everything outside the
 * working hours and the break, or the whole day on non-working days and holidays. Day-and-night
 * machines run every day, so nothing is shaded (holidays are still marked on the column, by name).
 */
export function nonWorking(date: string, pattern: WorkPattern, runsNonstop: boolean): { startMin: number; endMin: number }[] {
  if (runsNonstop) return [];
  const iso = ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
  if (!pattern.days.includes(iso) || pattern.holidays.has(date)) return [{ startMin: 0, endMin: DAY }];
  const out = [
    { startMin: 0, endMin: pattern.shiftStart },
    { startMin: pattern.shiftEnd, endMin: DAY },
  ];
  if (pattern.breakStart != null && pattern.breakEnd != null) out.push({ startMin: pattern.breakStart, endMin: pattern.breakEnd });
  return out.filter((b) => b.endMin > b.startMin);
}

/** Hours booked on each day (Mon-Sun): overlapping bookings (parallel jobs) count once. */
export function bookedHoursByDay(segments: DaySegment[]): number[] {
  const hours: number[] = [];
  for (let d = 0; d < 7; d++) {
    const list = segments.filter((g) => g.day === d).sort((a, b) => a.startMin - b.startMin);
    let total = 0;
    let curS = -1;
    let curE = -1;
    for (const g of list) {
      if (g.startMin > curE) {
        if (curE > curS) total += curE - curS;
        curS = g.startMin;
        curE = g.endMin;
      } else curE = Math.max(curE, g.endMin);
    }
    if (curE > curS) total += curE - curS;
    hours.push(Math.round((total / 60) * 10) / 10);
  }
  return hours;
}

/** "6.5 h", "0 h". */
export const hoursText = (h: number) => `${h.toLocaleString("en-IN", { maximumFractionDigits: 1 })} h`;

/** "Running now: 2 · Free now: 4 · This week: 62% booked". */
export function boardSummary(running: number, free: number, weekPct: number | null): string {
  return `Running now: ${running} · Free now: ${free} · This week: ${weekPct == null ? "-" : `${Math.round(weekPct)}%`} booked`;
}
