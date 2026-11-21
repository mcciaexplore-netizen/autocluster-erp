import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { bookTime } from "@/db/booking-writer";
import { createMachine } from "@/db/machine-writer";
import { addPurchaseOrder } from "@/db/po-writer";
import * as s from "@/db/schema";
import { changeQuotationStatus } from "@/db/ticket-writer";
import { finishJob, handOverJob, OtherJobRunningError, pauseJob, startJob } from "@/db/work-writer";
import { istAt } from "@/lib/planning/hours";
import { actualHours, quotedVsActual } from "@/lib/planning/work";
import { EMPTY_MACHINE_FORM } from "@/lib/validation/planning";
import { freshDemoData, makeQuote, testDb, ticketsOf } from "./helpers";

const skip = !!process.env.SKIP_DB_TESTS;
const { db, pool } = testDb();
afterAll(async () => {
  await pool.end();
});
const at = (date: string, time: string) => istAt(date, Number(time.slice(0, 2)) * 60 + Number(time.slice(3)));

describe.skipIf(skip)("operators' work on jobs (database)", () => {
  beforeEach(async () => {
    await freshDemoData(db);
  });

  async function setup() {
    const q = await makeQuote(db, "Sahyadri", [
      { name: "5-axis machining", q: { hours: 6 } },
      { name: "5-axis machining", q: { hours: 2 } },
    ]);
    await changeQuotationStatus(db, q.id, "ACCEPTED", "2026-11-27");
    const ts = await ticketsOf(db, q.id);
    await addPurchaseOrder(db, { ticketIds: ts.map((t) => t.id), poNumber: "SAC-1", poDate: "2026-11-27", poAmountPaise: 1_00, fileId: null, notes: null }, "2026-11-27");
    const js = await db.select().from(s.jobs);
    const job = (t: (typeof ts)[number]) => js.find((j) => j.ticketId === t.id)!;
    const m = await createMachine(db, { ...EMPTY_MACHINE_FORM, name: "5-Axis VMC (Non-Continuous)", deptCode: "PPF" });
    const [op] = await db.insert(s.teamMembers).values({ name: "Amit Patil" }).returning();
    return { a: job(ts[0]), b: job(ts[1]), m, op };
  }

  it("start 10:00, pause 12:00, resume 14:00, done 15:30: 3.5 actual hours; quoted 6 h -> under; Done frees the rest of the booking", async () => {
    const { a, m, op } = await setup();
    const NOW = at("2026-11-30", "08:00");
    await bookTime(db, { jobId: a.id, machineId: m.id, start: at("2026-11-30", "10:00"), hours: 6 }, { now: NOW }); // to 16:30
    await startJob(db, a.id, { operatorId: op.id, now: at("2026-11-30", "10:00") });
    expect((await db.select().from(s.jobs).where(eq(s.jobs.id, a.id)))[0].status).toBe("RUNNING");
    await expect(pauseJob(db, a.id, "Lunch", null)).rejects.toThrow(/choose why/);
    await pauseJob(db, a.id, "Waiting for material", "Collet ordered", { operatorId: op.id, now: at("2026-11-30", "12:00") });
    expect((await db.select().from(s.jobs).where(eq(s.jobs.id, a.id)))[0]).toMatchObject({ status: "ON_HOLD", holdReason: "Waiting for material: Collet ordered" });
    await startJob(db, a.id, { operatorId: op.id, now: at("2026-11-30", "14:00") });
    await expect(finishJob(db, a.id, { note: "ok" })).rejects.toThrow(/completion note/);
    await finishJob(db, a.id, { note: "Impeller finished and deburred", qtyDone: "4 of 4", operatorId: op.id }, { now: at("2026-11-30", "15:30") });
    const logs = await db.select().from(s.jobTimeLogs).where(eq(s.jobTimeLogs.jobId, a.id));
    expect(actualHours(logs)).toBe(3.5);
    expect(logs.map((l) => l.pauseReason)).toEqual(["Waiting for material: Collet ordered", null]);
    expect(quotedVsActual(6, 3.5, 10)).toEqual({ pct: -41.7, flagged: false });
    const [b] = await db.select().from(s.jobBookings).where(eq(s.jobBookings.jobId, a.id));
    expect(b.endAt).toEqual(at("2026-11-30", "15:30")); // the machine is free from 15:30
    const [job] = await db.select().from(s.jobs).where(eq(s.jobs.id, a.id));
    expect(job).toMatchObject({ status: "DONE", doneNote: "Impeller finished and deburred", qtyDone: "4 of 4" });
    await expect(handOverJob(db, a.id, "2026-12-01", "")).rejects.toThrow(/who received/);
    await handOverJob(db, a.id, "2026-12-01", "Rohan Kulkarni (Sahyadri)");
    expect((await db.select().from(s.jobs).where(eq(s.jobs.id, a.id)))[0]).toMatchObject({ status: "HANDED_OVER", handedOverTo: "Rohan Kulkarni (Sahyadri)" });
    const ev = await db.select().from(s.jobEvents).where(eq(s.jobEvents.jobId, a.id));
    expect(ev.map((e) => e.type)).toEqual(["OPENED", "BOOKED", "STARTED", "PAUSED", "RESUMED", "DONE", "HANDED_OVER"]);
  });

  it("one running job per operator: starting another is refused, or pauses the first when asked", async () => {
    const { a, b, op } = await setup();
    await startJob(db, a.id, { operatorId: op.id, now: at("2026-11-30", "10:00") });
    const err = await startJob(db, b.id, { operatorId: op.id, now: at("2026-11-30", "11:00") }).catch((e) => e);
    expect(err).toBeInstanceOf(OtherJobRunningError);
    expect(err.message).toMatch(/You're already running ACDRI\/TK\/.* Pause it and start this one\?/);
    await startJob(db, b.id, { operatorId: op.id, pauseOther: true, now: at("2026-11-30", "11:00") });
    const [ja, jb] = await Promise.all([db.select().from(s.jobs).where(eq(s.jobs.id, a.id)), db.select().from(s.jobs).where(eq(s.jobs.id, b.id))]);
    expect(ja[0]).toMatchObject({ status: "ON_HOLD" });
    expect(ja[0].holdReason).toMatch(/^Started ACDRI\/TK/);
    expect(jb[0].status).toBe("RUNNING");
  });
});
