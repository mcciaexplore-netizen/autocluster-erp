/** Work on a job (brief section 8). Pure and unit-tested. */

export interface LogSpan {
  startedAt: Date;
  endedAt: Date | null;
}

/** Actual hours = the running periods added up (pauses left out); an open period counts to now. */
export function actualHours(logs: LogSpan[], now: Date = new Date()): number {
  const ms = logs.reduce((a, l) => a + Math.max(0, (l.endedAt ?? now).getTime() - l.startedAt.getTime()), 0);
  return ms / 3_600_000;
}

/** "Quoted 6 h, took 7 h (+16.7%)": the % over quoted, and whether it's past the alert %. */
export function quotedVsActual(quoted: number | null, actual: number, alertPct: number): { pct: number | null; flagged: boolean } {
  if (!quoted || !(actual > 0)) return { pct: null, flagged: false };
  const pct = Math.round(((actual - quoted) / quoted) * 1000) / 10;
  return { pct, flagged: pct > alertPct };
}

/**
 * "Still running?": a running job past its booked end by more than the warning % of the booked
 * time (e.g. 50% of an 8-hour booking = 4 hours past the end).
 */
export function isOverrun(booked: { start: Date; end: Date } | null, now: Date, warnPct: number): boolean {
  if (!booked) return false;
  const length = booked.end.getTime() - booked.start.getTime();
  return now.getTime() > booked.end.getTime() + (length * warnPct) / 100;
}

/** "14 h", "45 min", "2 days" since a moment. */
export function sinceText(from: Date, now: Date = new Date()): string {
  const min = Math.max(0, Math.round((now.getTime() - from.getTime()) / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} days`;
}

export const PAUSE_REASONS = ["Waiting for customer", "Waiting for material", "Machine problem", "Other"] as const;
export type PauseReason = (typeof PAUSE_REASONS)[number];
