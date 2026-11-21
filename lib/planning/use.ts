/**
 * Machine use % (brief section 11). Pure and unit-tested.
 * Available = working time (24 h a day for day-and-night machines) minus blocked time, times
 * "jobs at the same time". Booked / actual = the working time of bookings / running periods inside
 * the window.
 */
import { workingMinutesBetween, type Span, type WorkPattern } from "./hours";

/** Joins overlapping spans, so blocked time is never counted twice. */
export function mergeSpans(spans: Span[]): Span[] {
  const sorted = spans.filter((s) => s.end > s.start).sort((a, b) => a.start.getTime() - b.start.getTime());
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out.at(-1);
    if (last && s.start <= last.end) last.end = new Date(Math.max(last.end.getTime(), s.end.getTime()));
    else out.push({ start: new Date(s.start), end: new Date(s.end) });
  }
  return out;
}

const clip = (s: Span, w: Span): Span | null => {
  const start = new Date(Math.max(s.start.getTime(), w.start.getTime()));
  const end = new Date(Math.min(s.end.getTime(), w.end.getTime()));
  return end > start ? { start, end } : null;
};

export interface UseInput {
  window: Span;
  pattern: WorkPattern;
  nonstop: boolean;
  parallelJobs: number;
  blocks: Span[];
  bookings: Span[];
  running?: Span[];
}

export interface UseResult {
  /** Available hours (capacity), after blocked time. */
  availableHours: number;
  blockedHours: number;
  bookedHours: number;
  actualHours: number;
  /** null when nothing is available (e.g. blocked all week). */
  bookedPct: number | null;
  actualPct: number | null;
}

export function machineUse(u: UseInput): UseResult {
  const minutes = (s: Span) => workingMinutesBetween(s.start, s.end, u.pattern, u.nonstop);
  const inWindow = (list: Span[]) => list.map((s) => clip(s, u.window)).filter((s): s is Span => !!s);
  const total = minutes(u.window);
  const blocked = mergeSpans(inWindow(u.blocks)).reduce((a, s) => a + minutes(s), 0);
  const available = Math.max(0, total - blocked) * Math.max(1, u.parallelJobs);
  const booked = inWindow(u.bookings).reduce((a, s) => a + minutes(s), 0);
  const actual = inWindow(u.running ?? []).reduce((a, s) => a + (s.end.getTime() - s.start.getTime()) / 60_000, 0);
  const pct = (v: number) => (available > 0 ? (v / available) * 100 : null);
  return { availableHours: available / 60, blockedHours: blocked / 60, bookedHours: booked / 60, actualHours: actual / 60, bookedPct: pct(booked), actualPct: pct(actual) };
}

/** Monday 00:00 (India) of the week holding `date`, as "YYYY-MM-DD". */
export function weekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - back * 86_400_000).toISOString().slice(0, 10);
}
