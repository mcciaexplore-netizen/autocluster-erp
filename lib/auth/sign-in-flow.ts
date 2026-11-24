/**
 * The sign-in checks (section 1), apart from the web request so they can be tested:
 * - too many failed tries from one IP address: refused;
 * - 5 wrong passwords for an account: locked for 15 minutes, even with the right password;
 * - every attempt is recorded (sign_in_attempts) and goes to the Activity log with the IP address.
 * The same "not right" answer is given for an unknown email, a deactivated person and a wrong password.
 */
import { eq } from "drizzle-orm";
import type { DB } from "../../db/client";
import { appUsers, signInAttempts } from "../../db/schema";
import { accountLockedUntil, ipBlocked, LOCK_AFTER, LOCK_MINUTES } from "./sign-in-limits";

export const WRONG = "Email or password is not right.";
export const tooManyTries = (until: Date | null, now: Date) => {
  const mins = until ? Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 60_000)) : LOCK_MINUTES;
  return `Too many tries. Try again in ${mins} ${mins === 1 ? "minute" : "minutes"}.`;
};

export type SignInLog = (e: { success: boolean; userId: string | null; summary: string }) => Promise<void>;

export type SignInResult = { ok: true; user: typeof appUsers.$inferSelect } | { ok: false; message: string };

export async function checkSignIn(
  db: DB,
  input: { email: string; ip: string | null; now?: Date },
  /** Checks the password (and creates the session); true when it was right. */
  tryPassword: () => Promise<boolean>,
  log: SignInLog,
): Promise<SignInResult> {
  const now = input.now ?? new Date();
  const { email, ip } = input;
  const record = (success: boolean, reason: string | null) => db.insert(signInAttempts).values({ email, ip, success, reason, createdAt: now });

  if (await ipBlocked(db, ip, now)) {
    await record(false, "ip_limit");
    await log({ success: false, userId: null, summary: `Sign-in refused for ${email}: too many tries from this address` });
    return { ok: false, message: tooManyTries(null, now) };
  }
  const [u] = await db.select().from(appUsers).where(eq(appUsers.email, email));
  const known = u && u.canSignIn && !u.deactivatedAt && u.authUserId ? u : null;

  const lockedUntil = await accountLockedUntil(db, email, now);
  if (lockedUntil) {
    await record(false, "locked");
    await log({ success: false, userId: known?.id ?? null, summary: `Sign-in refused for ${email}: account locked after ${LOCK_AFTER} wrong passwords` });
    return { ok: false, message: tooManyTries(lockedUntil, now) };
  }
  if (!known) {
    await record(false, u ? "not_allowed" : "unknown_email");
    await log({ success: false, userId: null, summary: `Failed sign-in for ${email}${u ? " (can't sign in)" : " (no such account)"}` });
    return { ok: false, message: WRONG };
  }
  if (!(await tryPassword())) {
    await record(false, "wrong_password");
    const nowLocked = await accountLockedUntil(db, email, now);
    await log({ success: false, userId: known.id, summary: `Failed sign-in for ${email}: wrong password${nowLocked ? `; locked for ${LOCK_MINUTES} minutes` : ""}` });
    return { ok: false, message: nowLocked ? tooManyTries(nowLocked, now) : WRONG };
  }
  await record(true, null);
  await db.update(appUsers).set({ lastSignInAt: now }).where(eq(appUsers.id, known.id));
  await log({ success: true, userId: known.id, summary: `Signed in` });
  return { ok: true, user: known };
}
