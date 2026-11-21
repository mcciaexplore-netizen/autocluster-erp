/**
 * Working-hours maths for Planning (brief section 4). Pure and unit-tested.
 * All dates and times are India time (Asia/Kolkata = UTC+5:30, no daylight saving), so a fixed
 * offset is exact. Dates are "YYYY-MM-DD" (India), times "HH:MM", instants are JS Dates.
 */

export interface WorkPattern {
  /** ISO weekdays that are working days: 1 = Monday ... 7 = Sunday. */
  days: number[];
  /** Minutes from midnight (India). */
  shiftStart: number;
  shiftEnd: number;
  breakStart: number | null;
  breakEnd: number | null;
  /** Holiday dates ("YYYY-MM-DD"). */
  holidays: ReadonlySet<string>;
}

const IST = 330 * 60_000;
const DAY = 86_400_000;
const MIN = 60_000;

/** "09:30" -> 570. */
export function parseHHMM(v: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m || Number(m[1]) > 24 || Number(m[2]) > 59) throw new Error(`Not a time: ${v}`);
  return Number(m[1]) * 60 + Number(m[2]);
}
/** 570 -> "09:30". */
export const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** The India date of an instant: "YYYY-MM-DD". */
export const istDate = (d: Date) => new Date(d.getTime() + IST).toISOString().slice(0, 10);
/** Minutes since India midnight (may have a fraction). */
export const istMinutes = (d: Date) => ((d.getTime() + IST) % DAY) / MIN;
/** The instant for an India date and minutes since midnight. */
export const istAt = (date: string, minutes: number) => new Date(Date.parse(`${date}T00:00:00Z`) - IST + Math.round(minutes * MIN));
/** "YYYY-MM-DD" + n days. */
export const dayPlus = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
/** 1 = Monday ... 7 = Sunday. */
export const isoWeekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() || 7;

export function patternFromSettings(s: { workingDays: number[]; shiftStart: string; shiftEnd: string; breakStart: string | null; breakEnd: string | null }, holidays: Iterable<string>): WorkPattern {
  const bs = s.breakStart ? parseHHMM(s.breakStart) : null;
  const be = s.breakEnd ? parseHHMM(s.breakEnd) : null;
  return {
    days: s.workingDays,
    shiftStart: parseHHMM(s.shiftStart),
    shiftEnd: parseHHMM(s.shiftEnd),
    breakStart: bs != null && be != null && be > bs ? bs : null,
    breakEnd: bs != null && be != null && be > bs ? be : null,
    holidays: new Set(holidays),
  };
}

/** The working periods of one date, as [start, end) minutes. Empty on days off and holidays. */
export function segmentsOn(date: string, p: WorkPattern): [number, number][] {
  if (!p.days.includes(isoWeekday(date)) || p.holidays.has(date)) return [];
  const { shiftStart: s, shiftEnd: e, breakStart: bs, breakEnd: be } = p;
  if (e <= s) return [];
  if (bs == null || be == null || be <= s || bs >= e) return [[s, e]];
  return [
    [s, Math.max(s, bs)],
    [Math.min(e, be), e],
  ].filter(([a, b]) => b > a) as [number, number][];
}

/** Working minutes in one day (e.g. 510 for 09:00-18:00 with a 30-minute break). */
export const workingMinutesOn = (date: string, p: WorkPattern) => segmentsOn(date, p).reduce((a, [s, e]) => a + e - s, 0);

const MAX_DAYS = 3660; // never loop forever (no working days at all)

/**
 * When a booking of `hours` starting at `start` ends. Machines that run day and night simply add
 * the hours. Other machines count only working time, skipping breaks, days off and holidays.
 * A booking that uses up its hours exactly at a break or the end of a shift ends there.
 */
export function addWorkingHours(start: Date, hours: number, p: WorkPattern, nonstop: boolean): Date {
  let remaining = Math.round(hours * 60 * 1000) / 1000; // minutes
  if (remaining <= 0) return start;
  if (nonstop) return new Date(start.getTime() + remaining * MIN);
  let day = istDate(start);
  let t = istMinutes(start);
  for (let i = 0; i < MAX_DAYS; i++) {
    for (const [s, e] of segmentsOn(day, p)) {
      if (t >= e) continue;
      const from = Math.max(t, s);
      const avail = e - from;
      if (remaining <= avail) return istAt(day, from + remaining);
      remaining -= avail;
      t = e;
    }
    day = dayPlus(day, 1);
    t = 0;
  }
  throw new Error("No working time found. Please check the working days in Settings.");
}

/** The first working moment at or after `t` (unchanged for day-and-night machines). */
export function nextWorkingMoment(t: Date, p: WorkPattern, nonstop: boolean): Date {
  if (nonstop) return t;
  let day = istDate(t);
  let m = istMinutes(t);
  for (let i = 0; i < MAX_DAYS; i++) {
    for (const [s, e] of segmentsOn(day, p)) {
      if (m < e) return istAt(day, Math.max(m, s));
    }
    day = dayPlus(day, 1);
    m = 0;
  }
  throw new Error("No working time found. Please check the working days in Settings.");
}

/** Working minutes between two instants (24 h a day for day-and-night machines). */
export function workingMinutesBetween(a: Date, b: Date, p: WorkPattern, nonstop: boolean): number {
  if (b <= a) return 0;
  if (nonstop) return (b.getTime() - a.getTime()) / MIN;
  let total = 0;
  for (let day = istDate(a), i = 0; day <= istDate(b) && i < MAX_DAYS; day = dayPlus(day, 1), i++) {
    for (const [s, e] of segmentsOn(day, p)) {
      const from = Math.max(istAt(day, s).getTime(), a.getTime());
      const to = Math.min(istAt(day, e).getTime(), b.getTime());
      if (to > from) total += (to - from) / MIN;
    }
  }
  return total;
}

/** Rounds to the nearest 30 minutes (bookings snap to half hours). */
export function snapTo30(d: Date): Date {
  const step = 30 * MIN;
  return new Date(Math.round(d.getTime() / step) * step);
}

export interface Span {
  start: Date;
  end: Date;
}
export const overlaps = (a: Span, b: Span) => a.start < b.end && b.start < a.end;

/**
 * The most spans running at the same moment inside `window` (a sweep over start/end points).
 * A new booking fits when this + 1 is not more than the machine's "jobs at the same time".
 */
export function maxAtOnce(spans: Span[], window: Span): number {
  const points: [number, number][] = [];
  for (const s of spans) {
    if (!overlaps(s, window)) continue;
    points.push([Math.max(s.start.getTime(), window.start.getTime()), 1], [Math.min(s.end.getTime(), window.end.getTime()), -1]);
  }
  // ends before starts at the same moment, so back-to-back bookings don't count as overlapping
  points.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  let cur = 0;
  let max = 0;
  for (const [, d] of points) {
    cur += d;
    max = Math.max(max, cur);
  }
  return max;
}

/** "Sat 28 Nov, 12:00" (India time). */
export function formatWhen(d: Date): string {
  const date = istDate(d);
  const dt = new Date(`${date}T00:00:00Z`);
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dt.getUTCDay()];
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][dt.getUTCMonth()];
  return `${wd} ${dt.getUTCDate()} ${mon}, ${hhmm(Math.round(istMinutes(d)))}`;
}

/** "6 h", "6.5 h", "45 min". */
export function formatHours(h: number): string {
  if (h > 0 && h < 1) return `${Math.round(h * 60)} min`;
  return `${Number(h.toFixed(1)).toLocaleString("en-IN")} h`;
}

/** "22 Nov, 17:00" (India time, no weekday). */
export const formatDayTime = (d: Date) => formatWhen(d).replace(/^\w{3} /, "");
