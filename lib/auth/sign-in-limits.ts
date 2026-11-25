/**
 * Failed sign-ins (section 1): 5 wrong passwords for an account lock it for 15 minutes; an IP
 * address gets at most 30 tries in 15 minutes. Counted from sign_in_attempts (a successful sign-in
 * starts the count again). Pure SQL helpers, used by the sign-in action and the Users page.
 * The time is always passed in (never a default), so pages read request data before the clock.
 */
import { sql } from "drizzle-orm";
import type { DB, Tx } from "../../db/client";

export const LOCK_AFTER = 5;
export const LOCK_MINUTES = 15;
export const IP_LIMIT = 30;

/** When this account's lock ends, or null when it isn't locked. */
export async function accountLockedUntil(db: DB | Tx, email: string, now: Date): Promise<Date | null> {
  const r = await db.execute<{ n: string; last: string | null }>(sql`
    with last_ok as (select max(created_at) as t from sign_in_attempts where email = ${email} and success)
    select count(*) as n, max(created_at)::text as last from sign_in_attempts
    where email = ${email} and not success and reason = 'wrong_password'
      and created_at > ${new Date(now.getTime() - LOCK_MINUTES * 60_000)}
      and created_at > coalesce((select t from last_ok), '-infinity'::timestamptz)`);
  const row = r.rows[0];
  if (Number(row?.n ?? 0) < LOCK_AFTER || !row?.last) return null;
  return new Date(new Date(row.last).getTime() + LOCK_MINUTES * 60_000);
}

/** Too many tries from one address? */
export async function ipBlocked(db: DB | Tx, ip: string | null, now: Date): Promise<boolean> {
  if (!ip) return false;
  const r = await db.execute<{ n: string }>(sql`
    select count(*) as n from sign_in_attempts where ip = ${ip} and not success and created_at > ${new Date(now.getTime() - LOCK_MINUTES * 60_000)}`);
  return Number(r.rows[0]?.n ?? 0) >= IP_LIMIT;
}

/** Emails locked right now (for the Users page "Locked" status). */
export async function lockedEmails(db: DB | Tx, now: Date): Promise<Set<string>> {
  const r = await db.execute<{ email: string }>(sql`
    select a.email from sign_in_attempts a
    where not a.success and a.reason = 'wrong_password' and a.email is not null
      and a.created_at > ${new Date(now.getTime() - LOCK_MINUTES * 60_000)}
      and a.created_at > coalesce((select max(b.created_at) from sign_in_attempts b where b.email = a.email and b.success), '-infinity'::timestamptz)
    group by a.email having count(*) >= ${LOCK_AFTER}`);
  return new Set(r.rows.map((x) => x.email));
}
