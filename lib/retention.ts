/**
 * Records kept (Settings > General): each night the Activity log entries and sign-in attempts older
 * than the settings are removed, a small batch at a time so the database stays quick. One summary
 * line goes to the Activity log. Never touches the records themselves.
 */
import { eq, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import { settings } from "../db/schema";

export const BATCH = 2000;
/** Stops after this many batches; anything left is removed the next night. */
export const MAX_BATCHES = 100;

export interface CleanUpResult {
  activityRemoved: number;
  attemptsRemoved: number;
  months: number;
  days: number;
  finished: boolean;
}

async function deleteOlder(db: DB, table: "activity_log" | "sign_in_attempts", cutoff: Date, budget: { batches: number }) {
  let removed = 0;
  while (budget.batches > 0) {
    budget.batches--;
    const r = await db.execute(sql`delete from ${sql.identifier(table)} where id in (select id from ${sql.identifier(table)} where created_at < ${cutoff} order by id limit ${BATCH})`);
    removed += r.rowCount ?? 0;
    if ((r.rowCount ?? 0) < BATCH) return { removed, done: true };
  }
  return { removed, done: false };
}

export const monthsBefore = (now: Date, months: number) => {
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
};

export async function cleanUpOldEntries(db: DB, now: Date): Promise<CleanUpResult> {
  const [s] = await db.select({ months: settings.activityKeepMonths, days: settings.signInKeepDays }).from(settings).where(eq(settings.id, 1));
  const months = s?.months ?? 24;
  const days = s?.days ?? 90;
  const budget = { batches: MAX_BATCHES };
  const a = await deleteOlder(db, "activity_log", monthsBefore(now, months), budget);
  const b = await deleteOlder(db, "sign_in_attempts", new Date(now.getTime() - days * 86_400_000), budget);
  return { activityRemoved: a.removed, attemptsRemoved: b.removed, months, days, finished: a.done && b.done };
}

const n = (x: number) => x.toLocaleString("en-IN");

/** "Removed 1,240 entries older than 24 months, and 312 sign-in attempts older than 90 days." */
export function cleanUpSummary(r: CleanUpResult): string | null {
  const parts: string[] = [];
  if (r.activityRemoved) parts.push(`${n(r.activityRemoved)} ${r.activityRemoved === 1 ? "entry" : "entries"} older than ${r.months} months`);
  if (r.attemptsRemoved) parts.push(`${n(r.attemptsRemoved)} sign-in ${r.attemptsRemoved === 1 ? "attempt" : "attempts"} older than ${r.days} days`);
  if (!parts.length) return null;
  return `Removed ${parts.join(", and ")}${r.finished ? "" : " (more will be removed tomorrow night)"}.`;
}
