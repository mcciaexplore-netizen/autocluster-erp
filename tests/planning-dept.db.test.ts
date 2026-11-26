/**
 * Department access in Planning: someone with only RPT gets no other department's machines, jobs or
 * bookings from any Planning page loader or action (checked by looking for every other department's
 * machine ids, machine names and ticket numbers in what comes back).
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ensureDefaultRoles } from "@/db/role-writer";
import * as s from "@/db/schema";
import { buildGrants } from "@/lib/auth/can";
import type { CurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_ROLES } from "@/lib/auth/permissions";
import { istDate } from "@/lib/planning/hours";
import { loadDemoData, wipe } from "@/scripts/demo-data";
import { testDb } from "./helpers";

const skip = !!process.env.SKIP_DB_TESTS;
const { db, pool } = testDb();

let current: CurrentUser | null = null;
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => current }));
vi.mock("@/db", () => ({ db }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));

/** A Planner (plus Planning Insights) limited to the given departments. */
function planner(departments: string[], all = false): CurrentUser {
  const r = DEFAULT_ROLES.find((x) => x.name === "Planner")!;
  const grants = buildGrants([{ scopeOwnDepartments: true, permissions: [...r.permissions] }], { allDepartments: all, departments });
  return { id: "00000000-0000-4000-8000-0000000000aa", authUserId: "t", sessionId: "t", name: "Test Planner", email: "t@example.com", mobile: null, teamMemberId: "00000000-0000-4000-8000-0000000000bb", mustChangePassword: false, isDemo: false, allDepartments: all, departments, roles: [{ id: 1, name: "Planner" }], grants };
}
const isForbidden = (e: unknown) => (e as { digest?: string })?.digest === "NEXT_HTTP_ERROR_FALLBACK;403";

describe.skipIf(skip)("Planning: a one-department person gets no other department's data", () => {
  let others: string[] = []; // ids, names and ticket numbers that belong to other departments
  let ppfMachine = "";
  let ppfJob = "";
  beforeAll(async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    await db.transaction(async (tx) => {
      await wipe(tx);
      await loadDemoData(tx, { quiet: true, orders: { blobFolder: "local" }, crm: true, inventory: true, planning: true });
    });
    await ensureDefaultRoles(db);
    const ms = (await db.execute<{ id: string; name: string; dept: string }>(sql`select id, name, dept_code as dept from machines`)).rows;
    const tks = (await db.execute<{ id: string; ticket_no: string; dept: string | null }>(sql`select j.id, t.ticket_no, t.snapshot->>'deptCode' as dept from jobs j join tickets t on t.id = j.ticket_id`)).rows;
    // Machine names that also appear in RPT text (e.g. "SLA") would give false alarms: only distinctive ones.
    others = [...ms.filter((m) => m.dept !== "RPT").flatMap((m) => [m.id, m.name]), ...tks.filter((t) => t.dept !== "RPT").flatMap((t) => [t.id, t.ticket_no])];
    ppfMachine = ms.find((m) => m.dept === "PPF")!.id;
    ppfJob = tks.find((t) => t.dept === "PPF")!.id;
    expect(others.length).toBeGreaterThan(50);
  }, 240_000);
  afterAll(() => pool.end());

  const leaks = (label: string, value: unknown) => {
    const text = JSON.stringify(value);
    const found = others.filter((o) => text.includes(`"${o}"`));
    return found.length ? [`${label}: ${found.slice(0, 3).join(", ")}${found.length > 3 ? ` (+${found.length - 3})` : ""}`] : [];
  };

  it("no other department in any Planning loader or action", async () => {
    current = planner(["RPT"]);
    const d = await import("@/lib/planning-data");
    const ins = await import("@/lib/planning-insights");
    const jobs = await import("@/lib/actions/jobs");
    const today = istDate(new Date());
    const found: string[] = [];
    const tf = await d.timelineFiltersFromParams({});
    expect(tf.dept).toBe("RPT");
    expect(tf.deptChoice?.picker).toBe(false); // one department: no picker at all
    found.push(...leaks("timeline", await d.getTimeline(tf)));
    found.push(...leaks("timeline asking for PPF", await d.getTimeline({ ...tf, dept: "PPF" })));
    found.push(...leaks("department board", await d.getDepartmentBoard({ dept: "RPT", date: today })));
    found.push(...leaks("department board asking for PPF", await d.getDepartmentBoard({ dept: "PPF", date: today })));
    found.push(...leaks("machines", await d.listMachines()));
    found.push(...leaks("machine picks", await d.getMachinePicks()));
    found.push(...leaks("jobs", await d.listJobs({})));
    found.push(...leaks("jobs asking for PPF", await d.listJobs({ dept: "PPF" })));
    found.push(...leaks("booking options (Show all machines)", await d.getBookingOptions()));
    found.push(...leaks("needs attention", await d.getNeedsAttention()));
    found.push(...leaks("today", await d.getToday()));
    found.push(...leaks("overdue breakdowns", await d.listOverdueBreakdowns()));
    found.push(...leaks("insights", await ins.getPlanningInsights(await ins.planningInsightFiltersFromParams({ dept: "PPF" }))));
    found.push(...leaks("job panel (PPF job)", await jobs.loadJobPanelAction(ppfJob)));
    found.push(...leaks("book a PPF job", await jobs.loadBookJobAction(ppfJob)));
    found.push(...leaks("free slots on PPF machines", await jobs.findSlotsAction([ppfMachine], 2)));
    expect(found).toEqual([]);
    // Another department's job is as if it didn't exist; another department's machine page is refused.
    expect(await d.getJobDetail(ppfJob)).toBeNull();
    await expect(d.getMachine(ppfMachine)).rejects.toSatisfy(isForbidden);
    current = null;
  });

  it("the home page's Planning cards count only their departments", async () => {
    const d = await import("@/lib/planning-data");
    current = planner([], true);
    const all = await d.getPlanningHomeStats();
    current = planner(["RPT"]);
    const rpt = await d.getPlanningHomeStats();
    expect(rpt.toPlan + rpt.running).toBeLessThan(all.toPlan + all.running);
    current = null;
  });

  it("department pickers: one department none; a few only theirs; every department plus All", async () => {
    const d = await import("@/lib/planning-data");
    current = planner(["RPT"]);
    const one = await d.planningDeptChoice(null);
    expect([one.picker, one.allowAll, one.chosen]).toEqual([false, false, "RPT"]);
    expect((await d.planningDeptChoice("PPF")).chosen).toBe("RPT"); // can't ask for another department
    current = planner(["RPT", "PPF", "MET"]);
    const few = await d.planningDeptChoice("all");
    expect([few.picker, few.allowAll, few.options.map((o) => o.code).sort()]).toEqual([true, false, ["MET", "PPF", "RPT"]]);
    expect(few.chosen).not.toBeNull(); // no "All" for a few departments
    current = planner([], true);
    const every = await d.planningDeptChoice("all");
    expect([every.allowAll, every.chosen, every.options.length]).toEqual([true, null, 5]);
    expect((await d.planningDeptChoice(null, { allByDefault: false })).chosen).not.toBeNull(); // the board opens on a department
    current = null;
  });

  it("a machine's page reads only its own bookings and blocked time, never another machine's (even in the same department)", async () => {
    const d = await import("@/lib/planning-data");
    current = planner([], true);
    // Two machines of one department that both have bookings in the same week.
    const [pair] = (
      await db.execute<{ a: string; b: string; week: string }>(sql`
        select x.machine_id as a, y.machine_id as b, to_char(date_trunc('week', x.start_at at time zone 'Asia/Kolkata'), 'YYYY-MM-DD') as week
        from job_bookings x
        join machines mx on mx.id = x.machine_id
        join job_bookings y on y.machine_id <> x.machine_id and y.cancelled_at is null
          and date_trunc('week', y.start_at at time zone 'Asia/Kolkata') = date_trunc('week', x.start_at at time zone 'Asia/Kolkata')
        join machines my on my.id = y.machine_id and my.dept_code = mx.dept_code
        where x.cancelled_at is null
        limit 1`)
    ).rows;
    expect(pair).toBeTruthy();
    // Blocked time on both machines that week.
    const at = new Date(`${pair.week}T10:00:00+05:30`);
    const until = new Date(at.getTime() + 2 * 3_600_000);
    await db.insert(s.machineBlocks).values([
      { machineId: pair.a, type: "MAINTENANCE", startAt: at, endAt: until, note: "test A" },
      { machineId: pair.b, type: "CALIBRATION", startAt: at, endAt: until, note: "test B" },
    ]);
    const theirs = (await db.execute<{ id: string }>(sql`select id from job_bookings where machine_id = ${pair.b} and cancelled_at is null`)).rows.map((r) => r.id);
    const mine = (await db.execute<{ id: string }>(sql`
      select id from job_bookings where machine_id = ${pair.a} and cancelled_at is null
        and start_at < ${new Date(at.getTime() + 7 * 86_400_000)} and end_at > ${new Date(`${pair.week}T00:00:00+05:30`)}`)).rows.map((r) => r.id);
    // What the machine page loads (the same call the page makes).
    const t = await d.getTimeline({ view: "week", date: pair.week, machine: pair.a });
    expect(t.bookings.length).toBeGreaterThan(0);
    expect(t.bookings.every((b) => b.machineId === pair.a)).toBe(true);
    expect(t.bookings.map((b) => b.id).sort()).toEqual([...mine].sort());
    expect(t.bookings.some((b) => theirs.includes(b.id))).toBe(false);
    expect(t.blocks.length).toBeGreaterThan(0);
    expect(t.blocks.every((b) => b.machineId === pair.a)).toBe(true);
    expect(t.blocks.some((b) => b.note === "test B")).toBe(false);
    current = null;
  });

  it("the board draws holidays and blocked time for the week", async () => {
    const d = await import("@/lib/planning-data");
    current = planner([], true);
    const [blk] = (await db.execute<{ start_at: string; dept: string }>(sql`select b.start_at::text, m.dept_code as dept from machine_blocks b join machines m on m.id = b.machine_id order by b.start_at desc limit 1`)).rows;
    const board = await d.getDepartmentBoard({ dept: blk.dept, date: istDate(new Date(blk.start_at)) });
    expect(board.blocks.length).toBeGreaterThan(0);
    const [hol] = await db.select().from(s.holidays).limit(1);
    const hb = await d.getDepartmentBoard({ dept: "RPT", date: hol.date });
    expect(hb.holidays.map((h) => h.date)).toContain(hol.date);
    expect(hb.holidays.find((h) => h.date === hol.date)?.name).toBe(hol.name);
    current = null;
  });
});
