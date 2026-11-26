import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { bookTime } from "@/db/booking-writer";
import { createMachine } from "@/db/machine-writer";
import { addPurchaseOrder } from "@/db/po-writer";
import * as s from "@/db/schema";
import { changeQuotationStatus } from "@/db/ticket-writer";
import { CantStartError, finishJob, pauseJob, startJob } from "@/db/work-writer";
import { istAt } from "@/lib/planning/hours";
import { actualHours } from "@/lib/planning/work";
import { EMPTY_MACHINE_FORM } from "@/lib/validation/planning";
import { freshDemoData, makeQuote, testDb, ticketsOf } from "./helpers";

const skip = !!process.env.SKIP_DB_TESTS;
const { db, pool } = testDb();
afterAll(async () => {
  await pool.end();
});
const at = (time: string) => istAt("2026-11-30", Number(time.slice(0, 2)) * 60 + Number(time.slice(3))); // Monday

describe.skipIf(skip)("one person running several machines at once (database)", () => {
  beforeEach(async () => {
    await freshDemoData(db);
  });

  /** n jobs (2 hours each), machines as asked, and Amit. */
  async function setup(n: number, ms: { name: string; runsNonstop?: boolean; operatorMustStay?: boolean; parallelJobs?: number }[]) {
    const q = await makeQuote(db, "Sahyadri", Array.from({ length: n }, () => ({ name: "5-axis machining", q: { hours: 2 } })));
    await changeQuotationStatus(db, q.id, "ACCEPTED", "2026-11-27");
    const ts = await ticketsOf(db, q.id);
    await addPurchaseOrder(db, { ticketIds: ts.map((t) => t.id), poNumber: "SAC-1", poDate: "2026-11-27", poAmountPaise: 1_00, fileId: null, notes: null }, "2026-11-27");
    const js = await db.select().from(s.jobs);
    const jobs = ts.map((t) => js.find((j) => j.ticketId === t.id)!);
    const machines = [];
    for (const m of ms) machines.push(await createMachine(db, { ...EMPTY_MACHINE_FORM, deptCode: "PPF", runsNonstop: false, operatorMustStay: false, parallelJobs: 1, ...m }));
    const [op] = await db.insert(s.teamMembers).values({ name: "Amit Patil" }).returning();
    return { jobs, machines, op };
  }
  const status = async (jobId: string) => (await db.select().from(s.jobs).where(eq(s.jobs.id, jobId)))[0].status;

  it("3 jobs on 3 machines at once by one operator; the 4th is refused at their limit, listing what they run; nothing is paused", async () => {
    const { jobs, machines, op } = await setup(5, [{ name: "5-Axis" }, { name: "3-Axis" }, { name: "Turn Mill" }, { name: "Drill" }, { name: "EDM" }]);
    await db.insert(s.appUsers).values({ teamMemberId: op.id, fullName: "Amit Patil", maxMachines: 3 });
    for (const [i, t] of ["10:00", "10:10", "10:20"].entries()) await startJob(db, jobs[i].id, { operatorId: op.id, machineId: machines[i].id, now: at(t) });
    expect(await Promise.all(jobs.slice(0, 3).map((j) => status(j.id)))).toEqual(["RUNNING", "RUNNING", "RUNNING"]);
    const err = (await startJob(db, jobs[3].id, { operatorId: op.id, machineId: machines[3].id, now: at("10:30") }).catch((e) => e)) as CantStartError;
    expect(err).toBeInstanceOf(CantStartError);
    expect(err.message).toBe("You're already running 3 machines (your limit).");
    expect(err.running.map((r) => r.machine)).toEqual(["5-Axis", "3-Axis", "Turn Mill"]);
    expect(await status(jobs[3].id)).not.toBe("RUNNING");
    expect(await Promise.all(jobs.slice(0, 3).map((j) => status(j.id)))).toEqual(["RUNNING", "RUNNING", "RUNNING"]); // no automatic pausing
    // Without their own number, the Settings one (default 4) applies: the 4th starts, the 5th is refused.
    await db.update(s.appUsers).set({ maxMachines: null }).where(eq(s.appUsers.teamMemberId, op.id));
    await startJob(db, jobs[3].id, { operatorId: op.id, machineId: machines[3].id, now: at("10:30") });
    await expect(startJob(db, jobs[4].id, { operatorId: op.id, machineId: machines[4].id, now: at("10:40") })).rejects.toThrow("You're already running 4 machines (your limit).");
    // Pausing one makes room.
    await pauseJob(db, jobs[0].id, "Waiting for material", null, { operatorId: op.id, now: at("10:45") });
    await startJob(db, jobs[4].id, { operatorId: op.id, machineId: machines[4].id, now: at("10:50") });
    expect(await status(jobs[4].id)).toBe("RUNNING");
  });

  it("an \"operator must stay\" machine blocks other starts, both ways (day-and-night machines aside)", async () => {
    const { jobs, machines, op } = await setup(4, [{ name: "CNC" }, { name: "CMM", operatorMustStay: true }, { name: "Lathe" }, { name: "Chamber", runsNonstop: true }]);
    const [cnc, cmm, lathe, chamber] = machines;
    await startJob(db, jobs[0].id, { operatorId: op.id, machineId: cnc.id, now: at("10:00") });
    // Running a CNC: can't start on the CMM.
    const e1 = (await startJob(db, jobs[1].id, { operatorId: op.id, machineId: cmm.id, now: at("10:30") }).catch((e) => e)) as CantStartError;
    expect(e1).toBeInstanceOf(CantStartError);
    expect(e1.message).toMatch(/^CMM needs you to stay at the machine, and you're running \d{4}\. Pause it first\.$/);
    expect(e1.running.map((r) => r.machine)).toEqual(["CNC"]);
    await pauseJob(db, jobs[0].id, "Waiting for material", null, { operatorId: op.id, now: at("10:40") });
    await startJob(db, jobs[1].id, { operatorId: op.id, machineId: cmm.id, now: at("10:45") });
    // On the CMM: can't start anything else (even a chamber).
    await expect(startJob(db, jobs[2].id, { operatorId: op.id, machineId: lathe.id, now: at("11:00") })).rejects.toThrow(/^CMM needs you to stay at the machine while \d{4} is running\. Pause or finish it first\.$/);
    await expect(startJob(db, jobs[3].id, { operatorId: op.id, machineId: chamber.id, now: at("11:00") })).rejects.toThrow(/CMM needs you to stay/);
    // Someone else isn't held by Amit's CMM.
    const [priya] = await db.insert(s.teamMembers).values({ name: "Priya Shah" }).returning();
    await startJob(db, jobs[2].id, { operatorId: priya.id, machineId: lathe.id, now: at("11:00") });
    // A chamber running on its own doesn't stop the CMM starting.
    await finishJob(db, jobs[1].id, { note: "Inspection done", operatorId: op.id }, { now: at("11:30") });
    await startJob(db, jobs[3].id, { operatorId: op.id, machineId: chamber.id, now: at("11:35") });
    // ...and with only a chamber running, the paused CNC job resumes too.
    await startJob(db, jobs[0].id, { operatorId: op.id, now: at("11:40") });
    expect(await status(jobs[0].id)).toBe("RUNNING");
  });

  it("a day-and-night chamber doesn't count toward the limit", async () => {
    const { jobs, machines, op } = await setup(3, [{ name: "Chamber", runsNonstop: true }, { name: "CNC" }, { name: "Lathe" }]);
    await db.insert(s.appUsers).values({ teamMemberId: op.id, fullName: "Amit Patil", maxMachines: 1 });
    await startJob(db, jobs[0].id, { operatorId: op.id, machineId: machines[0].id, now: at("10:00") });
    await startJob(db, jobs[1].id, { operatorId: op.id, machineId: machines[1].id, now: at("10:10") }); // the chamber doesn't count
    const err = (await startJob(db, jobs[2].id, { operatorId: op.id, machineId: machines[2].id, now: at("10:20") }).catch((e) => e)) as CantStartError;
    expect(err.message).toBe("You're already running 1 machine (your limit).");
    expect(err.running.map((r) => r.machine)).toEqual(["CNC"]);
  });

  it("the machine's \"Jobs at the same time\" is still enforced", async () => {
    const { jobs, machines, op } = await setup(3, [{ name: "Printer", parallelJobs: 2 }]);
    const [p] = machines;
    for (const j of jobs.slice(0, 2)) await bookTime(db, { jobId: j.id, machineId: p.id, start: at("10:00"), hours: 2, exactStart: true }, { now: at("09:00") });
    await startJob(db, jobs[0].id, { operatorId: op.id, now: at("10:00") });
    await startJob(db, jobs[1].id, { operatorId: op.id, now: at("10:05") }); // two on one machine count as one machine
    // A third job on it now is refused: the machine already runs as many jobs as it can.
    await expect(startJob(db, jobs[2].id, { operatorId: op.id, machineId: p.id, now: at("10:10") })).rejects.toThrow(/Printer/);
    expect(await status(jobs[2].id)).not.toBe("RUNNING");
  });

  it("overlapping jobs' actual hours are each correct; pausing one doesn't affect the others", async () => {
    const { jobs, machines, op } = await setup(3, [{ name: "5-Axis" }, { name: "3-Axis" }, { name: "Turn Mill" }]);
    await startJob(db, jobs[0].id, { operatorId: op.id, machineId: machines[0].id, now: at("10:00") });
    await startJob(db, jobs[1].id, { operatorId: op.id, machineId: machines[1].id, now: at("10:30") });
    await startJob(db, jobs[2].id, { operatorId: op.id, machineId: machines[2].id, now: at("11:00") });
    await pauseJob(db, jobs[0].id, "Machine problem", null, { operatorId: op.id, now: at("11:30") });
    expect(await Promise.all(jobs.map((j) => status(j.id)))).toEqual(["ON_HOLD", "RUNNING", "RUNNING"]);
    await finishJob(db, jobs[1].id, { note: "Parts finished", operatorId: op.id }, { now: at("12:00") });
    await finishJob(db, jobs[2].id, { note: "Parts finished", operatorId: op.id }, { now: at("12:30") });
    const hours = async (jobId: string) => actualHours(await db.select().from(s.jobTimeLogs).where(eq(s.jobTimeLogs.jobId, jobId)), at("13:00"));
    // Each job counts its own full machine time, overlapping or not.
    expect(await Promise.all(jobs.map((j) => hours(j.id)))).toEqual([1.5, 1.5, 1.5]);
  });
});
