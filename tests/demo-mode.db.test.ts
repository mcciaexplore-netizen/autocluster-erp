/**
 * Demo mode (Module 7, Phase 6):
 * - demo users for every role (section 10); Amit, Rohan and Priya keep their job and booking links,
 *   and their enquiries move to Neha Kulkarni with a history line; a few days of Activity log;
 * - with DEMO_MODE not "true": demo users can't be added, demo accounts don't work, "Try it as..."
 *   refuses, and db:reset / db:seed refuse to run.
 */
import { execFileSync } from "node:child_process";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DEMO_PIN, DEMO_USERS, demoEmail, setUpDemoUsers } from "@/db/demo-users";
import * as s from "@/db/schema";
import { readAccess } from "@/lib/auth/access";
import { createAuth } from "@/lib/auth/better-auth";
import { can } from "@/lib/auth/can";
import { NOT_DEMO_MESSAGE } from "@/lib/auth/demo-mode";
import { checkSignIn } from "@/lib/auth/sign-in-flow";
import { loadDemoData, wipe } from "@/scripts/demo-data";
import { TEST_DB_URL, testDb } from "./helpers";

const skip = !!process.env.SKIP_DB_TESTS;
const { db, pool } = testDb();
vi.mock("@/db", () => ({ db }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/auth/server", () => ({ auth: { api: {} } }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => null }));

const auth = createAuth(db);
const demoOn = () => (process.env.DEMO_MODE = "true");
const demoOff = () => delete process.env.DEMO_MODE;

describe.skipIf(skip)("demo mode (database)", () => {
  const before: Record<string, string> = {};
  let operatorLeads: string[] = [];
  beforeAll(async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN; // never upload from tests
    await db.transaction(async (tx) => {
      await wipe(tx);
      await loadDemoData(tx, { quiet: true, orders: { blobFolder: "local" }, crm: true, inventory: true, planning: true });
    });
    for (const n of ["Amit Patil", "Rohan Deshpande", "Priya Shah"]) before[n] = (await db.select().from(s.teamMembers).where(eq(s.teamMembers.name, n)))[0].id;
    operatorLeads = (await db.select({ id: s.leads.id }).from(s.leads).where(inArray(s.leads.assignedTo, Object.values(before)))).map((l) => l.id);
  }, 180_000);
  afterEach(demoOff);
  afterAll(() => pool.end());

  it("demo users can't be added unless DEMO_MODE is true", async () => {
    demoOff();
    await expect(setUpDemoUsers(db, auth)).rejects.toThrow(NOT_DEMO_MESSAGE);
    process.env.DEMO_MODE = "yes";
    await expect(setUpDemoUsers(db, auth)).rejects.toThrow(NOT_DEMO_MESSAGE);
    expect(await db.select().from(s.appUsers).where(eq(s.appUsers.isDemo, true))).toHaveLength(0);
  });

  it("adds a demo user for every role, as in section 10", async () => {
    demoOn();
    const jobsBefore = (await db.execute<{ n: string }>(sql`select count(*) as n from job_bookings where operator_id in (${sql.join(Object.values(before).map((v) => sql`${v}`), sql`, `)})`)).rows[0].n;
    await setUpDemoUsers(db, auth, { now: new Date("2026-11-25T06:00:00Z") });
    for (const d of DEMO_USERS) {
      const [u] = await db.select().from(s.appUsers).where(eq(s.appUsers.fullName, d.name));
      expect(u, d.name).toBeTruthy();
      expect(u.isDemo).toBe(true);
      expect(u.canSignIn).toBe(!d.nameOnly);
      expect(u.mustChangePassword).toBe(false);
      if (!d.nameOnly) expect(u.email).toBe(demoEmail(d.name));
      const roles = await db.select({ name: s.roles.name }).from(s.userRoles).innerJoin(s.roles, eq(s.roles.id, s.userRoles.roleId)).where(eq(s.userRoles.userId, u.id));
      expect(roles.map((r) => r.name).sort()).toEqual([...d.roles].sort());
      const depts = (await db.select().from(s.userDepartments).where(eq(s.userDepartments.userId, u.id))).map((x) => x.deptCode).sort();
      expect(u.allDepartments).toBe(d.depts === "all");
      if (d.depts !== "all") expect(depts).toEqual([...d.depts].sort());
      expect(!!u.pinHash).toBe(d.roles.includes("Operator"));
      if (u.pinHash) expect(u.pinHash).not.toContain(DEMO_PIN);
    }
    // Amit, Rohan and Priya are the same team members: their bookings still point to them.
    for (const [n, id] of Object.entries(before)) expect((await db.select().from(s.appUsers).where(eq(s.appUsers.fullName, n)))[0].teamMemberId).toBe(id);
    const jobsAfter = (await db.execute<{ n: string }>(sql`select count(*) as n from job_bookings where operator_id in (${sql.join(Object.values(before).map((v) => sql`${v}`), sql`, `)})`)).rows[0].n;
    expect(Number(jobsAfter)).toBe(Number(jobsBefore));
    expect(Number(jobsAfter)).toBeGreaterThan(0);
  });

  it("the operators' enquiries move to Neha Kulkarni, with a history line", async () => {
    expect(operatorLeads.length).toBeGreaterThan(0);
    const [neha] = await db.select().from(s.appUsers).where(eq(s.appUsers.fullName, "Neha Kulkarni"));
    const rows = await db.select().from(s.leads).where(inArray(s.leads.id, operatorLeads));
    expect(rows.every((l) => l.assignedTo === neha.teamMemberId)).toBe(true);
    const events = await db.select().from(s.leadEvents).where(eq(s.leadEvents.type, "ASSIGNED"));
    expect(events.filter((e) => /^Assigned to Neha Kulkarni \(was (Amit Patil|Rohan Deshpande|Priya Shah)\)$/.test(e.message))).toHaveLength(operatorLeads.length);
  });

  it("adds a few days of Activity log entries pointing at real records", async () => {
    const rows = await db.select().from(s.activityLog);
    expect(rows.length).toBeGreaterThan(15);
    const days = new Set(rows.map((r) => r.createdAt.toISOString().slice(0, 10)));
    expect(days.size).toBeGreaterThanOrEqual(3);
    expect(rows.some((r) => r.onBehalfOfUserId && r.summary.startsWith("Recorded by Sunita Joshi for Amit Patil"))).toBe(true);
  });

  it("demo accounts work only while DEMO_MODE is true", async () => {
    const [rohan] = await db.select().from(s.appUsers).where(eq(s.appUsers.fullName, "Rohan Deshpande"));
    demoOn();
    const a = await readAccess(db, rohan.authUserId!);
    expect(can(a, "planning.operate", { dept: "RPT" })).toBe(true);
    demoOff();
    expect(await readAccess(db, rohan.authUserId!)).toBeNull();
    const r = await checkSignIn(db, { email: rohan.email!, ip: null }, async () => true, async () => {});
    expect(r).toEqual({ ok: false, message: "Email or password is not right." });
  });

  it("“Try it as...” refuses unless DEMO_MODE is true", async () => {
    demoOff();
    const { tryAsAction } = await import("@/lib/actions/session");
    expect(await tryAsAction("Operator")).toEqual({ error: "Demo accounts are switched off on this site." });
  });

  it("db:reset and db:seed refuse to run unless DEMO_MODE is true", () => {
    const run = (script: string) => {
      try {
        execFileSync("node", ["node_modules/tsx/dist/cli.mjs", script], { env: { ...process.env, DEMO_MODE: "", DATABASE_URL: TEST_DB_URL, DATABASE_URL_UNPOOLED: TEST_DB_URL }, stdio: "pipe", timeout: 60_000, input: "" });
        return { code: 0, out: "" };
      } catch (e) {
        const err = e as { status: number; stdout: Buffer; stderr: Buffer };
        return { code: err.status, out: `${err.stdout}${err.stderr}` };
      }
    };
    for (const script of ["scripts/reset.ts", "scripts/seed.ts"]) {
      const r = run(script);
      expect(r.code, script).not.toBe(0);
      expect(r.out, script).toContain("not a demo database");
    }
  }, 120_000);
});
