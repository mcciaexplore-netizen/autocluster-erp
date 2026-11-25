/**
 * Shared shop-floor devices (Module 7, Phase 5):
 * - PINs: 4-6 digits, not easy to guess, stored only as a hash;
 * - PIN sign-in works only on a device marked shared (and not stopped), for people who may operate
 *   in its departments; 5 wrong PINs lock that PIN for 15 minutes;
 * - the floor session is signed, ends 10 minutes after its last action or when the device is
 *   stopped, and can only do Today's work, whatever the person's roles.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ensureDefaultRoles } from "@/db/role-writer";
import * as s from "@/db/schema";
import { deactivateUser, reactivateUser, saveUser } from "@/db/user-writer";
import { createAuth } from "@/lib/auth/better-auth";
import { can } from "@/lib/auth/can";
import { DEVICE_COOKIE, FLOOR_COOKIE, FLOOR_IDLE_MINUTES, floorExpiry, hashToken, newDeviceToken, pinProblem, pinSignIn, signFloor, verifyFloor, WRONG_PIN } from "@/lib/auth/floor-core";
import { loadDemoData, wipe } from "@/scripts/demo-data";
import { testDb } from "./helpers";

const skip = !!process.env.SKIP_DB_TESTS;
const { db, pool } = testDb();
const SECRET = "s".repeat(48);

// The request: its cookies (set by each test) and no Better Auth session.
const jar = new Map<string, string>();
const setCalls: { name: string; value: string }[] = [];
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined),
    set: (name: string, value: string) => {
      setCalls.push({ name, value });
      jar.set(name, value);
    },
    delete: (n: string) => jar.delete(n),
  }),
}));
vi.mock("@/lib/auth/server", () => ({ auth: { api: { getSession: async () => null } } }));
vi.mock("@/db", () => ({ db }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(fn: T) => fn }));

const auth = createAuth(db);
const check = async (hash: string, pin: string) => (await auth.$context).password.verify({ hash, password: pin });
const hashPin = async (pin: string) => (await auth.$context).password.hash(pin);

describe("PIN rules and the floor cookie", () => {
  it("PINs are 4 to 6 digits and not easy to guess", () => {
    expect(pinProblem("123")).toBe("Use 4 to 6 digits.");
    expect(pinProblem("12a4")).toBe("Use 4 to 6 digits.");
    expect(pinProblem("1234567")).toBe("Use 4 to 6 digits.");
    expect(pinProblem("1111")).toMatch(/too easy/);
    expect(pinProblem("1234")).toMatch(/too easy/);
    expect(pinProblem("9876")).toMatch(/too easy/);
    expect(pinProblem("4071")).toBeNull();
    expect(pinProblem("580263")).toBeNull();
  });

  it("the floor cookie is signed and expires", () => {
    const now = Date.now();
    const v = signFloor({ u: "a", d: "b", exp: now + 1000 }, SECRET);
    expect(verifyFloor(v, SECRET, now)).toEqual({ u: "a", d: "b", exp: now + 1000 });
    expect(verifyFloor(v, SECRET, now + 1001)).toBeNull(); // expired
    expect(verifyFloor(v, "t".repeat(48), now)).toBeNull(); // other secret
    const [body, mac] = v.split(".");
    const forged = Buffer.from(JSON.stringify({ u: "admin", d: "b", exp: now + 1000 })).toString("base64url");
    expect(verifyFloor(`${forged}.${mac}`, SECRET, now)).toBeNull();
    expect(verifyFloor(`${body}.x${mac.slice(1)}`, SECRET, now)).toBeNull();
    expect(floorExpiry(now)).toBe(now + FLOOR_IDLE_MINUTES * 60_000);
  });
});

describe.skipIf(skip)("shared shop-floor devices (database)", () => {
  let roles: Record<string, number>;
  let token = "";
  let deviceId = "";
  const ids: Record<string, string> = {};
  const temp = () => "a temporary password 1";

  beforeAll(async () => {
    process.env.AUTH_SECRET = SECRET;
    await db.transaction(async (tx) => {
      await wipe(tx);
      await loadDemoData(tx, { quiet: true });
    });
    await db.delete(s.signInAttempts);
    roles = await ensureDefaultRoles(db);
    const base = { mobile: null, allDepartments: false };
    ids.rohan = (await saveUser(db, auth, null, { ...base, name: "Rohan RPT", canSignIn: true, email: "rohan@example.com", roleIds: [roles.Operator], deptCodes: ["RPT"] }, temp)).id;
    ids.priya = (await saveUser(db, auth, null, { ...base, name: "Priya PPF", canSignIn: true, email: "priya@example.com", roleIds: [roles.Operator], deptCodes: ["PPF"] }, temp)).id;
    ids.amit = (await saveUser(db, auth, null, { ...base, name: "Amit Contract", canSignIn: false, email: null, roleIds: [roles.Operator], deptCodes: ["RPT"] }, temp)).id; // name only
    ids.asha = (await saveUser(db, auth, null, { ...base, allDepartments: true, name: "Asha Admin", canSignIn: true, email: "asha@example.com", roleIds: [roles.Admin], deptCodes: [] }, temp)).id;
    ids.nopin = (await saveUser(db, auth, null, { ...base, name: "Nikhil NoPin", canSignIn: true, email: "nikhil@example.com", roleIds: [roles.Operator], deptCodes: ["RPT"] }, temp)).id;
    for (const [k, pin] of [["rohan", "4071"], ["priya", "5820"], ["amit", "7315"], ["asha", "2468"]] as const) {
      await db.update(s.appUsers).set({ pinHash: await hashPin(pin) }).where(eq(s.appUsers.id, ids[k]));
    }
    token = newDeviceToken();
    const [d] = await db.insert(s.sharedDevices).values({ name: "RPT tablet", deptCodes: ["RPT"], tokenHash: hashToken(token) }).returning();
    deviceId = d.id;
  }, 120_000);
  afterAll(() => pool.end());

  const pinTry = (userId: string, pin: string, now = new Date(), deviceToken: string | null = token) => pinSignIn(db, check, { deviceToken, userId, pin, ip: "10.0.0.1", now });

  it("PINs are stored only as hashes", async () => {
    const [u] = await db.select().from(s.appUsers).where(eq(s.appUsers.id, ids.rohan));
    expect(u.pinHash).toBeTruthy();
    expect(u.pinHash).not.toContain("4071");
  });

  it("PIN sign-in works only on a shared device, for people of its departments with a PIN", async () => {
    expect(await pinTry(ids.rohan, "4071", new Date(), null)).toMatchObject({ ok: false, message: expect.stringMatching(/isn't set up as a shared/) });
    expect(await pinTry(ids.rohan, "4071", new Date(), newDeviceToken())).toMatchObject({ ok: false });
    expect(await pinTry(ids.priya, "5820")).toMatchObject({ ok: false, message: "Please choose your name again." }); // PPF, RPT tablet
    expect(await pinTry(ids.nopin, "1357")).toMatchObject({ ok: false }); // no PIN: not on the list
    const ok = await pinTry(ids.rohan, "4071");
    expect(ok).toMatchObject({ ok: true, name: "Rohan RPT", deviceName: "RPT tablet" });
    expect(await pinTry(ids.amit, "7315")).toMatchObject({ ok: true }); // name-only people may use a PIN here
    expect(await pinTry(ids.asha, "2468")).toMatchObject({ ok: true }); // all departments
  });

  it("5 wrong PINs lock that PIN for 15 minutes; the right one is refused meanwhile", async () => {
    const t0 = new Date(Date.now() + 86_400_000); // after the sign-ins above (a success starts the count again)
    for (let i = 0; i < 4; i++) expect(await pinTry(ids.amit, "0000", new Date(t0.getTime() + i * 1000))).toEqual({ ok: false, message: WRONG_PIN });
    expect(await pinTry(ids.amit, "0000", new Date(t0.getTime() + 5000))).toEqual({ ok: false, message: "Too many wrong PINs. Try again in 15 minutes." });
    expect(await pinTry(ids.amit, "7315", new Date(t0.getTime() + 60_000))).toMatchObject({ ok: false, message: expect.stringMatching(/^Too many wrong PINs/) });
    expect(await pinTry(ids.amit, "7315", new Date(t0.getTime() + 16 * 60_000))).toMatchObject({ ok: true });
    expect(await pinTry(ids.rohan, "4071", new Date(t0.getTime() + 60_000))).toMatchObject({ ok: true }); // others aren't affected
  });

  it("deactivated people can't use their PIN", async () => {
    await deactivateUser(db, ids.amit);
    expect(await pinTry(ids.amit, "7315")).toMatchObject({ ok: false });
    await reactivateUser(db, ids.amit);
  });

  describe("the floor session", () => {
    const enter = (userId: string, exp = floorExpiry()) => {
      jar.clear();
      jar.set(DEVICE_COOKIE, token);
      jar.set(FLOOR_COOKIE, signFloor({ u: userId, d: deviceId, exp }, SECRET));
    };
    const me = async () => (await import("@/lib/auth/current-user")).getCurrentUser();

    it("can only do Today's work, even for an Admin", async () => {
      enter(ids.asha);
      const u = (await me())!;
      expect(u.floor).toMatchObject({ deviceId, deviceName: "RPT tablet" });
      expect(can(u, "planning.operate")).toBe(true);
      for (const p of ["users.manage", "orders.view", "quotes.edit", "money.sale_prices", "crm.view", "planning.book"] as const) expect(can(u, p)).toBe(false);
      enter(ids.rohan);
      const r = (await me())!;
      expect(can(r, "planning.operate", { dept: "RPT" })).toBe(true);
      expect(can(r, "planning.operate", { dept: "PPF" })).toBe(false); // still only his departments
      expect(can(r, "inventory.use_own_jobs", { dept: "RPT" })).toBe(true);
    });

    it("works for name-only people", async () => {
      enter(ids.amit);
      expect((await me())?.name).toBe("Amit Contract");
    });

    it("ends after 10 idle minutes, without the device cookie, or when the device is stopped", async () => {
      enter(ids.rohan, Date.now() - 1);
      expect(await me()).toBeNull();
      enter(ids.rohan);
      jar.delete(DEVICE_COOKIE);
      expect(await me()).toBeNull();
      enter(ids.rohan);
      jar.set(FLOOR_COOKIE, signFloor({ u: ids.rohan, d: "00000000-0000-4000-8000-000000000000", exp: floorExpiry() }, SECRET)); // another device
      expect(await me()).toBeNull();
      enter(ids.rohan);
      expect(await me()).not.toBeNull();
      await db.update(s.sharedDevices).set({ revokedAt: new Date() }).where(eq(s.sharedDevices.id, deviceId));
      expect(await me()).toBeNull();
      expect(await pinTry(ids.rohan, "4071")).toMatchObject({ ok: false }); // and PINs stop working there
      await db.update(s.sharedDevices).set({ revokedAt: null }).where(eq(s.sharedDevices.id, deviceId));
    });

    it("each allowed action starts the 10 minutes again; a refused one doesn't", async () => {
      const { allow } = await import("@/lib/auth/guard");
      const soon = Date.now() + 60_000; // about to expire
      enter(ids.rohan, soon);
      setCalls.length = 0;
      expect((await allow("orders.view")).ok).toBe(false);
      expect(setCalls).toHaveLength(0);
      expect((await allow("planning.operate", { dept: "RPT" })).ok).toBe(true);
      const renewed = verifyFloor(setCalls.find((c) => c.name === FLOOR_COOKIE)?.value, SECRET);
      expect(renewed?.exp).toBeGreaterThan(soon + 8 * 60_000);
    });
  });
});
