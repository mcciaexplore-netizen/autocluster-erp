/**
 * Module 7, Phase 4:
 * - 5 wrong passwords lock an account for 15 minutes (the right password is refused meanwhile);
 *   too many tries from one IP address are refused; every attempt is recorded;
 * - the Activity log gets the records' own histories from one central helper, only for a
 *   signed-in person, and a log line that can't be written never undoes the work;
 * - the Activity log page filters by person, area and dates, and hides sale prices from people
 *   who may not see them.
 */
import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { logLeadEvent } from "@/db/lead-writer";
import { ensureDefaultRoles } from "@/db/role-writer";
import * as s from "@/db/schema";
import { saveUser } from "@/db/user-writer";
import { setActorResolver } from "@/lib/auth/actor";
import { createAuth } from "@/lib/auth/better-auth";
import { buildGrants } from "@/lib/auth/can";
import type { CurrentUser } from "@/lib/auth/current-user";
import { checkSignIn, WRONG, type SignInLog } from "@/lib/auth/sign-in-flow";
import { IP_LIMIT, LOCK_MINUTES } from "@/lib/auth/sign-in-limits";
import { loadDemoData, wipe } from "@/scripts/demo-data";
import { testDb } from "./helpers";

const skip = !!process.env.SKIP_DB_TESTS;
const { db, pool } = testDb();

let current: CurrentUser | null = null;
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => current }));
vi.mock("@/db", () => ({ db }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7", "user-agent": "test" }) }));

const auth = createAuth(db);
const RIGHT = "the right password 42";
const noLog = async () => {};

describe.skipIf(skip)("sign-in limits and the Activity log (database)", () => {
  let user: { id: string; teamMemberId: string; name: string };
  beforeAll(async () => {
    await db.transaction(async (tx) => {
      await wipe(tx);
      await loadDemoData(tx, { quiet: true, crm: true });
    });
    const roles = await ensureDefaultRoles(db);
    const r = await saveUser(db, auth, null, { name: "Ravi Sales", canSignIn: true, email: "ravi@example.com", mobile: null, roleIds: [roles.Sales], allDepartments: true, deptCodes: [] }, () => RIGHT);
    const [u] = await db.select().from(s.appUsers).where(eq(s.appUsers.id, r.id));
    user = { id: u.id, teamMemberId: u.teamMemberId, name: u.fullName };
    // The test DB keeps rows between runs of this file only through these tables.
    await db.delete(s.signInAttempts);
    await db.delete(s.activityLog);
  }, 120_000);
  afterEach(() => {
    current = null;
    setActorResolver(async () => null);
  });
  afterAll(() => pool.end());

  const attempt = (password: string, now: Date, ip = "198.51.100.1", log: SignInLog = noLog) => checkSignIn(db, { email: "ravi@example.com", ip, now }, async () => password === RIGHT, log);

  it("5 wrong passwords lock the account for 15 minutes; the right one is refused meanwhile", async () => {
    const t0 = new Date("2026-11-20T04:00:00Z");
    for (let i = 0; i < 4; i++) expect(await attempt("wrong", new Date(t0.getTime() + i * 1000))).toEqual({ ok: false, message: WRONG });
    const fifth = await attempt("wrong", new Date(t0.getTime() + 5000));
    expect(fifth).toEqual({ ok: false, message: "Too many tries. Try again in 15 minutes." });
    expect(await attempt(RIGHT, new Date(t0.getTime() + 60_000))).toMatchObject({ ok: false, message: expect.stringMatching(/^Too many tries\. Try again in 1[45] minutes\.$/) });
    // After the lock ends, the right password works and the count starts again.
    const after = new Date(t0.getTime() + 5000 + LOCK_MINUTES * 60_000 + 1000);
    expect(await attempt(RIGHT, after)).toMatchObject({ ok: true });
    expect(await attempt("wrong", new Date(after.getTime() + 1000))).toEqual({ ok: false, message: WRONG });
    const reasons = (await db.select().from(s.signInAttempts).where(eq(s.signInAttempts.email, "ravi@example.com"))).map((a) => a.reason ?? "ok");
    expect(reasons).toEqual([...Array(5).fill("wrong_password"), "locked", "ok", "wrong_password"]);
  });

  it("an unknown email gets the same answer and doesn't lock anyone", async () => {
    const r = await checkSignIn(db, { email: "nobody@example.com", ip: "198.51.100.2", now: new Date("2026-11-21T04:00:00Z") }, async () => true, noLog);
    expect(r).toEqual({ ok: false, message: WRONG });
  });

  it("too many failed tries from one IP address are refused, even for a right password", async () => {
    const t0 = new Date("2026-11-22T04:00:00Z");
    const ip = "192.0.2.50";
    await db.insert(s.signInAttempts).values(Array.from({ length: IP_LIMIT }, (_, i) => ({ email: `guess${i}@example.com`, ip, success: false, reason: "unknown_email", createdAt: new Date(t0.getTime() + i) })));
    expect(await attempt(RIGHT, new Date(t0.getTime() + 60_000), ip)).toMatchObject({ ok: false, message: expect.stringMatching(/^Too many tries/) });
    expect(await attempt(RIGHT, new Date(t0.getTime() + 60_000), "192.0.2.51")).toMatchObject({ ok: true }); // other addresses are fine
  });

  it("sign-ins and failed sign-ins go to the Activity log with the IP address", async () => {
    const { logActivity } = await import("@/lib/activity");
    const log = (e: { success: boolean; userId: string | null; summary: string }) => logActivity({ area: "Sign-in", action: e.success ? "signed in" : "failed sign-in", summary: e.summary, entityType: "user", entityId: e.userId, userId: e.userId });
    await attempt("wrong", new Date("2026-11-23T04:00:00Z"), "198.51.100.9", log);
    await attempt(RIGHT, new Date("2026-11-23T04:01:00Z"), "198.51.100.9", log);
    const rows = await db.select().from(s.activityLog).where(eq(s.activityLog.area, "Sign-in")).orderBy(s.activityLog.id);
    expect(rows.map((r) => [r.action, r.userId, r.ip])).toEqual([
      ["failed sign-in", user.id, "203.0.113.7"],
      ["signed in", user.id, "203.0.113.7"],
    ]);
    expect(rows[0].summary).toBe("Failed sign-in for ravi@example.com: wrong password");
    expect(JSON.stringify(rows)).not.toContain(RIGHT);
  });

  it("records' own histories reach the Activity log for a signed-in person, never for scripts", async () => {
    await import("@/lib/activity"); // registers the hook, as the app does
    const [lead] = await db.select().from(s.leads).limit(1);
    await logLeadEvent(db, lead.id, "NOTE", "Script note"); // nobody signed in: no log line
    expect(await db.select().from(s.activityLog).where(eq(s.activityLog.entityId, lead.id))).toHaveLength(0);

    setActorResolver(async () => ({ userId: user.id, name: user.name, teamMemberId: user.teamMemberId }));
    await db.transaction(async (tx) => logLeadEvent(tx, lead.id, "NOTE", "Called the customer"));
    const [row] = await db.select().from(s.activityLog).where(eq(s.activityLog.entityId, lead.id));
    expect(row).toMatchObject({ area: "CRM", action: "note", summary: "Called the customer", entityType: "lead", userId: user.id });
  });

  it("a log line that can't be written never undoes the work", async () => {
    await import("@/lib/activity");
    const [lead] = await db.select().from(s.leads).limit(1);
    setActorResolver(async () => ({ userId: "00000000-0000-4000-8000-0000000000ff", name: "Ghost", teamMemberId: user.teamMemberId })); // no such user: the log insert fails
    await db.transaction(async (tx) => logLeadEvent(tx, lead.id, "NOTE", "Still saved"));
    expect(await db.select().from(s.leadEvents).where(and(eq(s.leadEvents.leadId, lead.id), eq(s.leadEvents.message, "Still saved")))).toHaveLength(1);
  });

  it("the Activity log page filters by person, area and dates, and hides sale prices when needed", async () => {
    const { listActivity, recordHref } = await import("@/lib/activity-data");
    const [lead] = await db.select().from(s.leads).limit(1);
    await db.insert(s.activityLog).values([
      { userId: user.id, area: "Orders", action: "payment", summary: "Payment of ₹12,500 recorded", entityType: "lead", entityId: lead.id, createdAt: new Date("2026-10-05T06:00:00Z") },
      { userId: null, area: "Inventory", action: "in", summary: "Stock received: IN-1", createdAt: new Date("2026-10-06T06:00:00Z") },
    ]);
    const admin = (custom: string[]): CurrentUser => ({ id: user.id, authUserId: "t", sessionId: "t", name: "Admin", email: "a@example.com", mobile: null, teamMemberId: user.teamMemberId, mustChangePassword: false, isDemo: false, allDepartments: true, departments: [], roles: [], grants: buildGrants([{ scopeOwnDepartments: false, permissions: custom }], { allDepartments: true, departments: [] }) });

    current = admin(["users.manage", "money.sale_prices"]);
    const orders = await listActivity({ area: "Orders", from: "2026-10-05", to: "2026-10-05" });
    expect(orders.rows.map((r) => r.summary)).toEqual(["Payment of ₹12,500 recorded"]);
    expect(orders.rows[0]).toMatchObject({ who: "Ravi Sales", href: `/crm/enquiries/${lead.id}`, ip: null });
    expect((await listActivity({ from: "2026-10-06", to: "2026-10-06" })).rows.map((r) => r.area)).toEqual(["Inventory"]);
    expect((await listActivity({ user: user.id, from: "2026-10-01", to: "2026-10-31" })).rows).toHaveLength(1);
    expect(recordHref("ticket", "x")).toBe("/orders?ticket=x");

    current = admin(["users.manage"]); // may manage users, may not see sale prices
    expect((await listActivity({ area: "Orders", from: "2026-10-05", to: "2026-10-05" })).rows[0].summary).toBe("Payment of (amount hidden) recorded");

    current = admin(["crm.view"]);
    await expect(listActivity({})).rejects.toThrow();
  });

  it("there is never a plain password in the attempts or the log", async () => {
    const all = await db.execute(sql`select (select json_agg(a) from sign_in_attempts a)::text as a, (select json_agg(l) from activity_log l)::text as l`);
    expect(JSON.stringify(all.rows)).not.toContain(RIGHT);
  });
});
