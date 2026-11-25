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

  it("each demo operator has a job on every working day of the next 3 weeks, in their departments", async () => {
    const [set] = await db.select().from(s.settings);
    const hols = new Set((await db.select().from(s.holidays)).map((h) => h.date));
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
    const workingDays: string[] = [];
    for (let d = 0; d < 21; d++) {
      const date = new Date(Date.parse(`${today}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);
      const iso = ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
      if (set.workingDays.includes(iso) && !hols.has(date)) workingDays.push(date);
    }
    expect(workingDays.length).toBeGreaterThanOrEqual(12);
    const DEPTS: Record<string, string[]> = { "Amit Patil": ["PPF", "MET"], "Rohan Deshpande": ["RPT"], "Priya Shah": ["ENV", "RPL"] };
    for (const [name, depts] of Object.entries(DEPTS)) {
      const r = await db.execute<{ day: string; dept: string; status: string }>(sql`
        select distinct to_char(b.start_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as day, m.dept_code as dept, j.status
        from job_bookings b join jobs j on j.id = b.job_id join machines m on m.id = b.machine_id join team_members tm on tm.id = b.operator_id
        where tm.name = ${name} and b.cancelled_at is null and j.status = 'PLANNED'`);
      const days = new Set(r.rows.map((x) => x.day));
      for (const d of workingDays) expect(days.has(d), `${name} on ${d}`).toBe(true);
      expect(r.rows.filter((x) => workingDays.includes(x.day)).every((x) => depts.includes(x.dept)), name).toBe(true);
    }
    // The planning stories are still there: the 5-Axis VMC is over 90% booked.
    const [vmc] = await db.select().from(s.machines).where(eq(s.machines.name, "5-Axis VMC (Non-Continuous)"));
    const vmcJobs = await db.execute<{ op: string | null }>(sql`select distinct tm.name as op from job_bookings b left join team_members tm on tm.id = b.operator_id where b.machine_id = ${vmc.id} and b.end_at > now() and b.cancelled_at is null`);
    expect(vmcJobs.rows.length).toBeGreaterThan(0);
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

  it("demo sign-ins never sign out other sessions: two people using “Try it as Operator” at once both stay signed in", async () => {
    demoOn();
    const { demoSignIn } = await import("@/lib/auth/demo-sign-in");
    const [rohan] = await db.select().from(s.appUsers).where(eq(s.appUsers.fullName, "Rohan Deshpande"));
    const who = { id: rohan.id, authUserId: rohan.authUserId!, email: rohan.email! };
    const first = await demoSignIn(db, auth, who, new Headers());
    // Two more at the same moment (each changes the password once, under a lock).
    const [a, b] = await Promise.all([demoSignIn(db, auth, who, new Headers()), demoSignIn(db, auth, who, new Headers())]);
    const tokens = [first.token, a.token, b.token];
    expect(new Set(tokens).size).toBe(3);
    const sessions = await db.select().from(s.authSessions).where(eq(s.authSessions.userId, rohan.authUserId!));
    for (const t of tokens) expect(sessions.some((x) => x.token === t)).toBe(true);
    expect(sessions.every((x) => x.expiresAt > new Date())).toBe(true);
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
