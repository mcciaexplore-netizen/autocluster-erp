import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { bookTime } from "@/db/booking-writer";
import { createMachine } from "@/db/machine-writer";
import { addPurchaseOrder } from "@/db/po-writer";
import * as s from "@/db/schema";
import { changeQuotationStatus } from "@/db/ticket-writer";
import { finishJob, handOverJob, NeedMachineError, pauseJob, startJob } from "@/db/work-writer";
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

  it("Start with no booking covering now: asks which machine, books from now for the time still needed, can remove the later booking; refused if another job is on that machine now", async () => {
    const { a, b, m, op } = await setup();
    const NOW = at("2026-11-30", "10:00");
    // a has a later booking (tomorrow); time needed 6 h
    const later = await bookTime(db, { jobId: a.id, machineId: m.id, start: at("2026-12-01", "09:00"), hours: 6 }, { now: NOW });
    const ask = (await startJob(db, a.id, { operatorId: op.id, now: NOW }).catch((e) => e)) as NeedMachineError;
    expect(ask).toBeInstanceOf(NeedMachineError);
    expect(ask.info).toMatchObject({ suggestedMachineId: m.id, hours: 6, later: { bookingId: later.booking.id, machine: "5-Axis VMC (Non-Continuous)" } });
    await startJob(db, a.id, { operatorId: op.id, machineId: m.id, removeLaterBookingId: later.booking.id, now: NOW });
    const bs = await db.select().from(s.jobBookings).where(eq(s.jobBookings.jobId, a.id));
    const live = bs.filter((x) => !x.cancelledAt);
    expect(live).toHaveLength(1);
    expect(live[0].startAt).toEqual(NOW); // starts now, not snapped
    expect(live[0].endAt).toEqual(at("2026-11-30", "16:30")); // 6 working hours
    expect(bs.find((x) => x.id === later.booking.id)!.cancelledAt).not.toBeNull();
    const [log] = await db.select().from(s.jobTimeLogs).where(eq(s.jobTimeLogs.jobId, a.id));
    expect(log.bookingId).toBe(live[0].id); // the log counts against the booking it ran in
    // b on the same machine right now: refused plainly, and not started
    const err = await startJob(db, b.id, { operatorId: null, machineId: m.id, now: at("2026-11-30", "11:00") }).catch((e) => e);
    expect(err.message).toMatch(/5-Axis VMC \(Non-Continuous\) is already booked for DMC\/TK\/.* from Mon 30 Nov, 10:00 to 16:30\./);
    expect((await db.select().from(s.jobs).where(eq(s.jobs.id, b.id)))[0].status).not.toBe("RUNNING");
  });
});
