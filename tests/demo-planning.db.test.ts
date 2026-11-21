import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as s from "@/db/schema";
import { dayPlus, istAt, istDate } from "@/lib/planning/hours";
import { machineUse } from "@/lib/planning/use";
import { patternFromSettings } from "@/lib/planning/hours";
import { loadDemoData, wipe } from "@/scripts/demo-data";
import { testDb } from "./helpers";

const skip = !!process.env.SKIP_DB_TESTS;
const { db, pool } = testDb();

describe.skipIf(skip)("planning demo data (database)", () => {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const now = new Date();
  const today = istDate(now);
  let story: Awaited<ReturnType<typeof loadDemoData>>;
  beforeAll(async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN; // never upload from tests
    await db.transaction(async (tx) => {
      await wipe(tx);
      story = await loadDemoData(tx, { quiet: true, orders: { blobFolder: "local" }, crm: true, inventory: true, planning: true, now });
    });
  }, 400_000);
  afterAll(async () => {
    if (token) process.env.BLOB_READ_WRITE_TOKEN = token;
    await pool.end();
  });

  const jobsWith = (where: ReturnType<typeof sql>) =>
    db.execute<{ id: string; status: string; priority: string; promised_date: string | null; hold_reason: string | null }>(
      sql`select j.id, j.status, j.priority, j.promised_date::text, j.hold_reason from jobs j join tickets t on t.id = j.ticket_id where ${where}`,
    );

  it("33 machines in 5 departments, the ACDRI profile and holidays", async () => {
    const ms = await db.select().from(s.machines);
    expect(ms).toHaveLength(33);
    expect(new Set(ms.map((m) => m.deptCode)).size).toBe(5);
    expect(ms.find((m) => m.name === "Salt Spray Test Chamber")?.parallelJobs).toBe(2);
    expect(ms.find((m) => m.name === "HDT & VICAT Softening Temperature Tester")?.parallelJobs).toBe(3);
    expect(ms.filter((m) => m.deptCode === "ENV").every((m) => m.runsNonstop && m.nablAccredited)).toBe(true);
    const [set] = await db.select().from(s.settings);
    expect(set.orgName).toBe("Auto Cluster Development and Research Institute (ACDRI)");
    expect(set.orgEmail).toBe("customersupport@autoclusterpune.org");
    expect((await db.select().from(s.holidays)).length).toBeGreaterThan(3);
  });

  it("5-Axis VMC is over 90% booked for the next 2 weeks", async () => {
    const [vmc] = await db.select().from(s.machines).where(eq(s.machines.name, "5-Axis VMC (Non-Continuous)"));
    const [set] = await db.select().from(s.settings);
    const hs = await db.select().from(s.holidays);
    const bs = await db.execute<{ start_at: string; end_at: string }>(sql`select start_at::text, end_at::text from job_bookings where machine_id = ${vmc.id} and cancelled_at is null`);
    const use = machineUse({
      window: { start: now, end: istAt(dayPlus(today, 14), 0) },
      pattern: patternFromSettings(set, hs.map((h) => h.date)),
      nonstop: false,
      parallelJobs: 1,
      blocks: [],
      bookings: bs.rows.map((b) => ({ start: new Date(b.start_at), end: new Date(b.end_at) })),
    });
    expect(use.bookedPct).toBeGreaterThanOrEqual(90);
    expect(story?.vmcBookedPct).toBeGreaterThanOrEqual(90);
  });

  it("running now, on hold, to plan (urgent and past its promised date), and a late job", async () => {
    expect((await jobsWith(sql`j.status = 'RUNNING'`)).rows).toHaveLength(1);
    const running = await db.execute(sql`select 1 from job_time_logs where ended_at is null`);
    expect(running.rows).toHaveLength(1);
    const hold = (await jobsWith(sql`j.status = 'ON_HOLD'`)).rows;
    expect(hold.map((h) => h.hold_reason)).toEqual(["Waiting for customer drawings"]);
    const toPlan = (await jobsWith(sql`j.status = 'TO_PLAN'`)).rows;
    expect(toPlan.some((j) => j.priority === "URGENT")).toBe(true);
    expect(toPlan.some((j) => j.promised_date != null && j.promised_date < today)).toBe(true);
    const late = await db.execute(sql`
      select 1 from jobs j where j.status in ('PLANNED', 'RUNNING') and j.promised_date is not null
        and (select max(b.end_at) from job_bookings b where b.job_id = j.id and b.cancelled_at is null) > (j.promised_date + 1)::timestamp at time zone 'Asia/Kolkata'`);
    expect(late.rows.length).toBeGreaterThanOrEqual(1);
  });

  it("one tentative hold expires tomorrow and one has expired; a machine is under maintenance next week; a breakdown in the last 30 days", async () => {
    const holds = await db.execute<{ hold_until: string }>(sql`select hold_until::text from job_bookings where is_tentative and cancelled_at is null order by hold_until`);
    expect(holds.rows.map((h) => h.hold_until)).toEqual([dayPlus(today, -1), dayPlus(today, 1)]);
    const blocks = await db.execute<{ type: string; start_at: string }>(sql`select type, start_at::text from machine_blocks`);
    expect(blocks.rows.some((b) => b.type === "MAINTENANCE" && new Date(b.start_at) > now)).toBe(true);
    expect(blocks.rows.some((b) => b.type === "BREAKDOWN" && istDate(new Date(b.start_at)) >= dayPlus(today, -30))).toBe(true);
    expect((await db.select().from(s.machines)).every((m) => m.status === "AVAILABLE")).toBe(true);
  });

  it("8 weeks of done jobs with time logs, three over 10% longer than quoted, and custom-item jobs on the laser and the CMM", async () => {
    const done = await db.execute(sql`select distinct l.job_id from job_time_logs l join jobs j on j.id = l.job_id where j.status in ('DONE', 'HANDED_OVER') and l.started_at > now() - interval '57 days'`);
    expect(done.rows.length).toBeGreaterThanOrEqual(20);
    const over = await db.execute<{ quoted: string; actual: string }>(sql`
      select qi.billable_qty as quoted, (select sum(extract(epoch from (l.ended_at - l.started_at))) / 3600 from job_time_logs l where l.job_id = j.id) as actual
      from jobs j join tickets t on t.id = j.ticket_id join quotation_items qi on qi.id = t.quotation_item_id
      where j.status in ('DONE', 'HANDED_OVER') and qi.unit_type = 'PER_HOUR' and not qi.is_custom_item`);
    expect(over.rows.filter((r) => r.actual && Number(r.actual) > Number(r.quoted) * 1.1)).toHaveLength(3);
    const custom = await db.execute<{ machine: string }>(sql`
      select distinct m.name as machine from job_bookings b join machines m on m.id = b.machine_id join jobs j on j.id = b.job_id
      join tickets t on t.id = j.ticket_id join quotation_items qi on qi.id = t.quotation_item_id where qi.is_custom_item`);
    const names = custom.rows.map((r) => r.machine);
    expect(names).toContain("5+1 Axis Laser (Rotary Attachment)");
    expect(names).toContain("Co-ordinate Measuring Machine (CMM)");
  });

  it("no booking clashes: never more jobs at once than a machine takes, and none over blocked time", async () => {
    const clashes = await db.execute(sql`
      select b1.id from job_bookings b1 join job_bookings b2 on b1.machine_id = b2.machine_id and b1.id < b2.id
        and b1.cancelled_at is null and b2.cancelled_at is null and b1.start_at < b2.end_at and b2.start_at < b1.end_at
      join machines m on m.id = b1.machine_id where m.parallel_jobs = 1`);
    expect(clashes.rows).toHaveLength(0);
    const overBlocks = await db.execute(sql`
      select b.id from job_bookings b join machine_blocks k on k.machine_id = b.machine_id
      where b.cancelled_at is null and b.start_at < k.end_at and k.start_at < b.end_at`);
    expect(overBlocks.rows).toHaveLength(0);
  });
});
