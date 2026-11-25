/**
 * Shared shop-floor devices (section 7), without any web request so it can be tested.
 *
 * - An Admin marks a browser as a shared device: it keeps a random token in a long-lived cookie;
 *   the database keeps only its SHA-256 hash (shared_devices.token_hash).
 * - On that device an operator taps their name and enters their 4-6 digit PIN (hashed like a
 *   password). They get a short "floor session": a signed cookie naming them and the device,
 *   valid for 10 minutes from their last action, and only while the device is still shared.
 * - A floor session can only do Today's work: start, pause, finish, hand over, record materials.
 * - 5 wrong PINs lock that person's PIN for 15 minutes. PINs work only on shared devices.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { DB } from "../../db/client";
import { appUsers, sharedDevices, signInAttempts } from "../../db/schema";
import type { Grants } from "./can";
import { accountLockedUntil, LOCK_MINUTES } from "./sign-in-limits";
import { isDemoMode } from "./demo-mode";

export { DEVICE_COOKIE, FLOOR_COOKIE } from "./floor-cookies";
export const FLOOR_IDLE_MINUTES = 10;
export const DEVICE_COOKIE_DAYS = 400;

/** What a floor session may do, at most (still limited by the person's own roles and departments). */
export const FLOOR_PERMS = ["planning.view", "planning.operate", "inventory.use_own_jobs", "inventory.use"] as const;

export function floorGrants(grants: Grants): Grants {
  return Object.fromEntries(Object.entries(grants).filter(([p]) => (FLOOR_PERMS as readonly string[]).includes(p)));
}

// ---- device tokens ----------------------------------------------------------------------------

export const newDeviceToken = () => randomBytes(32).toString("base64url");
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function findDevice(db: DB, token: string | null | undefined) {
  if (!token || token.length < 20 || token.length > 200) return null;
  const [d] = await db.select().from(sharedDevices).where(and(eq(sharedDevices.tokenHash, hashToken(token)), isNull(sharedDevices.revokedAt)));
  return d ?? null;
}

// ---- the floor session cookie -----------------------------------------------------------------

export interface FloorSession {
  /** app_users.id */
  u: string;
  /** shared_devices.id */
  d: string;
  /** expires (ms since 1970) */
  exp: number;
}

const sign = (body: string, secret: string) => createHmac("sha256", secret).update(`floor:${body}`).digest("base64url");

export function signFloor(s: FloorSession, secret: string): string {
  const body = Buffer.from(JSON.stringify(s)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

export function verifyFloor(value: string | null | undefined, secret: string | undefined, now = Date.now()): FloorSession | null {
  if (!value || !secret || secret.length < 32) return null;
  const [body, mac] = value.split(".");
  if (!body || !mac) return null;
  const want = Buffer.from(sign(body, secret));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const s = JSON.parse(Buffer.from(body, "base64url").toString()) as FloorSession;
    if (typeof s.u !== "string" || typeof s.d !== "string" || typeof s.exp !== "number" || s.exp <= now) return null;
    return s;
  } catch {
    return null;
  }
}

export const floorExpiry = (now = Date.now()) => now + FLOOR_IDLE_MINUTES * 60_000;

// ---- PINs ---------------------------------------------------------------------------------------

const RUNS = "0123456789012345 9876543210987654";

/** A plain message, or null when the PIN is fine. */
export function pinProblem(pin: string): string | null {
  if (!/^\d{4,6}$/.test(pin)) return "Use 4 to 6 digits.";
  if (/^(\d)\1+$/.test(pin) || RUNS.includes(pin)) return "That PIN is too easy to guess. Try other digits.";
  return null;
}

/** The people who can use a shared device: active, with a PIN, allowed to operate in its departments. */
export async function floorPeople(db: DB, deviceDepts: string[]) {
  const r = await db.execute<{ id: string; name: string; everywhere: boolean; depts: string[] | null }>(sql`
    select u.id, u.full_name as name,
      (u.all_departments or bool_or(not r.scope_own_departments)) as everywhere,
      (select array_agg(ud.dept_code) from user_departments ud where ud.user_id = u.id) as depts
    from app_users u
    join user_roles ur on ur.user_id = u.id
    join roles r on r.id = ur.role_id
    join role_permissions rp on rp.role_id = r.id and rp.permission = 'planning.operate'
    where u.deactivated_at is null and u.pin_hash is not null and (not u.is_demo or ${isDemoMode()})
    group by u.id, u.full_name, u.all_departments
    order by u.full_name`);
  return r.rows
    .filter((p) => !deviceDepts.length || p.everywhere || (p.depts ?? []).some((d) => deviceDepts.includes(d)))
    .map((p) => ({ id: p.id, name: p.name }));
}

export type PinCheck = (hash: string, pin: string) => Promise<boolean>;

export const pinKey = (userId: string) => `pin:${userId}`;
export const WRONG_PIN = "That PIN is not right.";
export const pinLockedMessage = (until: Date, now: Date) => {
  const mins = Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 60_000));
  return `Too many wrong PINs. Try again in ${mins} ${mins === 1 ? "minute" : "minutes"}.`;
};

/** PIN sign-in on a shared device. Records every try; 5 wrong ones lock that PIN for 15 minutes. */
export async function pinSignIn(
  db: DB,
  checkPin: PinCheck,
  input: { deviceToken: string | null | undefined; userId: string; pin: string; ip: string | null; now?: Date },
): Promise<{ ok: true; session: FloorSession; name: string; deviceName: string } | { ok: false; message: string }> {
  const now = input.now ?? new Date();
  const device = await findDevice(db, input.deviceToken);
  if (!device) return { ok: false, message: "This device isn't set up as a shared shop-floor device. Ask your admin." };
  const key = pinKey(input.userId);
  const record = (success: boolean, reason: string | null) => db.insert(signInAttempts).values({ email: key, ip: input.ip, success, reason, createdAt: now });

  const people = await floorPeople(db, device.deptCodes);
  const person = people.find((p) => p.id === input.userId);
  if (!person) return { ok: false, message: "Please choose your name again." };

  const until = await accountLockedUntil(db, key, now);
  if (until) {
    await record(false, "locked");
    return { ok: false, message: pinLockedMessage(until, now) };
  }
  const [u] = await db.select({ pinHash: appUsers.pinHash }).from(appUsers).where(eq(appUsers.id, input.userId));
  if (!u?.pinHash || !/^\d{4,6}$/.test(input.pin) || !(await checkPin(u.pinHash, input.pin))) {
    await record(false, "wrong_password");
    const locked = await accountLockedUntil(db, key, now);
    return { ok: false, message: locked ? pinLockedMessage(locked, now) : WRONG_PIN };
  }
  await record(true, null);
  return { ok: true, session: { u: input.userId, d: device.id, exp: floorExpiry(now.getTime()) }, name: person.name, deviceName: device.name };
}

export { LOCK_MINUTES };
