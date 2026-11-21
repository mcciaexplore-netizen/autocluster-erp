import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { bookTime, cancelBooking, extendHold, findFreeSlots, moveBooking, moveToNextFreeSlot, PastBookingError } from "@/db/booking-writer";
import { addHoliday, blockMachine, createMachine, markBreakdown, updateMachine } from "@/db/machine-writer";
import { backfillJobs, bulkMarkDone } from "@/db/job-writer";
import { sql } from "drizzle-orm";
import { addPurchaseOrder } from "@/db/po-writer";
import * as s from "@/db/schema";
import { cancelTicket, changeQuotationStatus } from "@/db/ticket-writer";
import { istAt } from "@/lib/planning/hours";
import { EMPTY_MACHINE_FORM } from "@/lib/validation/planning";
import { freshDemoData, makeQuote, testDb, ticketsOf } from "./helpers";

const skip = !!process.env.SKIP_DB_TESTS;
const { db, pool } = testDb();
afterAll(async () => {
  await pool.end();
});
const at = (date: string, time: string) => istAt(date, Number(time.slice(0, 2)) * 60 + Number(time.slice(3)));
const NOW = at("2026-11-27", "09:00"); // Friday
const TODAY = "2026-11-27";

/** Accepts a quotation with the named services; returns its jobs (one per ticket, in order). */
async function acceptedJobs(company: string, lines: Parameters<typeof makeQuote>[2]) {
  const q = await makeQuote(db, company, lines);
  await changeQuotationStatus(db, q.id, "ACCEPTED", TODAY);
  const ts = await ticketsOf(db, q.id);
  const js = await db.select().from(s.jobs);
  return ts.map((t) => ({ ticket: t, job: js.find((j) => j.ticketId === t.id)! }));
}

async function firmTicket(ticketId: string) {
  await addPurchaseOrder(db, { ticketIds: [ticketId], poNumber: `PO-${ticketId.slice(0, 6)}`, poDate: TODAY, poAmountPaise: 100_00, fileId: null, notes: null }, TODAY);
}

describe.skipIf(skip)("jobs and booking machine time (database)", () => {
  beforeEach(async () => {
    await freshDemoData(db);
  });

  it("accepting a quotation with 3 services makes 3 jobs in To plan; cancelling a ticket cancels its job and frees its bookings", async () => {
    const js = await acceptedJobs("Western", [
      { name: "Thermal shock chamber", q: { hours: 48 } },
      { name: "UTM", q: { samples: 5 } },
      { name: "FTIR", q: { samples: 8 } },
    ]);
    expect(js.map((x) => [x.job.status, x.job.hoursNeeded])).toEqual([
      ["TO_PLAN", "48.00"], // per-hour service: the billable hours
      ["TO_PLAN", null], // no time settings on UTM yet
      ["TO_PLAN", null],
    ]);
    // the job uses the ticket number
    const m = await createMachine(db, { ...EMPTY_MACHINE_FORM, name: "Thermal Shock Test Chamber", deptCode: "ENV", runsNonstop: true });
    await bookTime(db, { jobId: js[0].job.id, machineId: m.id, start: at("2026-11-30", "10:00"), hours: 48 }, { now: NOW });
    expect((await db.select().from(s.jobs).where(eq(s.jobs.id, js[0].job.id)))[0].status).toBe("PLANNED");
    await cancelTicket(db, js[0].ticket.id, "Customer postponed the test");
    expect((await db.select().from(s.jobs).where(eq(s.jobs.id, js[0].job.id)))[0].status).toBe("CANCELLED");
    const [b] = await db.select().from(s.jobBookings).where(eq(s.jobBookings.jobId, js[0].job.id));
    expect(b.cancelledAt).not.toBeNull();
    const events = await db.select().from(s.jobEvents).where(eq(s.jobEvents.jobId, js[0].job.id));
    expect(events.map((e) => e.type)).toEqual(["OPENED", "BOOKED", "CANCELLED"]);
  });

  it("jobs at the same time = 1: an overlapping booking is refused with a plain message; back-to-back is fine; the end follows working hours", async () => {
    const [a, b2] = await acceptedJobs("Sahyadri", [
      { name: "5-axis machining", q: { hours: 4 } },
      { name: "5-axis machining", q: { hours: 2 } },
    ]);
    const m = await createMachine(db, { ...EMPTY_MACHINE_FORM, name: "5-Axis VMC (Non-Continuous)", deptCode: "PPF" });
    await firmTicket(a.ticket.id);
    const r = await bookTime(db, { jobId: a.job.id, machineId: m.id, start: at("2026-11-30", "10:00"), hours: 4 }, { now: NOW });
    expect(r.booking.endAt).toEqual(at("2026-11-30", "14:30")); // 10-13 + 13:30-14:30
    expect(r.booking.isTentative).toBe(false);
    await expect(bookTime(db, { jobId: b2.job.id, machineId: m.id, start: at("2026-11-30", "12:00"), hours: 2 }, { now: NOW })).rejects.toThrow(
      `5-Axis VMC (Non-Continuous) is already booked for ${a.ticket.ticketNo} from Mon 30 Nov, 10:00 to 14:30.`,
    );
    await expect(bookTime(db, { jobId: b2.job.id, machineId: m.id, start: at("2026-11-30", "14:30"), hours: 2 }, { now: NOW })).resolves.toBeTruthy();
  });

  it("jobs at the same time = 2: a third overlapping booking is refused; 10 saves at the same moment: only 2 succeed", async () => {
    const js = await acceptedJobs("Kaveri", Array.from({ length: 10 }, () => ({ name: "Mini salt spray chamber", q: { hours: 24 } })));
    const m = await createMachine(db, { ...EMPTY_MACHINE_FORM, name: "Salt Spray Test Chamber", deptCode: "ENV", runsNonstop: true, parallelJobs: 2 });
    const results = await Promise.allSettled(js.map((x) => bookTime(db, { jobId: x.job.id, machineId: m.id, start: at("2026-11-30", "10:00"), hours: 24 }, { now: NOW })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    const refused = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(refused.reason.message).toMatch(/already has 2 jobs at the same time/);
    expect(await db.select().from(s.jobBookings).where(eq(s.jobBookings.machineId, m.id))).toHaveLength(2);
  });

  it("refused over blocked time, and on machines that are broken down or inactive", async () => {
    const [a] = await acceptedJobs("Deccan", [{ name: "DSC", q: { samples: 4 } }]);
    const m = await createMachine(db, { ...EMPTY_MACHINE_FORM, name: "Differential Scanning Calorimeter (DSC)", deptCode: "RPL" });
    await blockMachine(db, { machineId: m.id, type: "CALIBRATION", start: at("2026-12-01", "09:00"), end: at("2026-12-01", "18:00") });
    await expect(bookTime(db, { jobId: a.job.id, machineId: m.id, start: at("2026-12-01", "11:00"), hours: 2 }, { now: NOW })).rejects.toThrow(/is not available \(calibration\) from Tue 1 Dec, 09:00 to 18:00/);
    await markBreakdown(db, m.id, at("2026-11-28", "18:00"), null, { now: NOW });
    // during the breakdown: refused; after it is expected back: allowed (e.g. moving a clashing booking there)
    await expect(bookTime(db, { jobId: a.job.id, machineId: m.id, start: at("2026-11-27", "11:00"), hours: 2 }, { now: NOW })).rejects.toThrow(/is not available \(breakdown\)/);
    const after = await bookTime(db, { jobId: a.job.id, machineId: m.id, start: at("2026-12-03", "11:00"), hours: 1 }, { now: NOW });
    expect(after.booking.startAt).toEqual(at("2026-12-03", "11:00"));
    // still marked broken down after the expected time: refused until someone says it's working again
    await expect(bookTime(db, { jobId: a.job.id, machineId: m.id, start: at("2026-12-04", "11:00"), hours: 1 }, { now: at("2026-11-30", "09:00") })).rejects.toThrow(/still marked as broken down/);
    await updateMachine(db, m.id, { ...EMPTY_MACHINE_FORM, name: m.name, deptCode: "RPL", status: "INACTIVE" });
    await expect(bookTime(db, { jobId: a.job.id, machineId: m.id, start: at("2026-12-03", "11:00"), hours: 2 }, { now: NOW })).rejects.toThrow(/is inactive/);
  });

  it("waiting for PO: booked as tentative with a hold; firm once the PO is saved; expired holds stay until someone acts", async () => {
    const [a] = await acceptedJobs("Indus", [{ name: "3+1 axis machining", q: { hours: 6 } }]);
    const m = await createMachine(db, { ...EMPTY_MACHINE_FORM, name: "3+1 Axis VMC (Rotary Attachment)", deptCode: "PPF" });
    const r = await bookTime(db, { jobId: a.job.id, machineId: m.id, start: at("2026-12-02", "09:00"), hours: 6 }, { now: NOW });
    expect(r.booking).toMatchObject({ isTentative: true, holdUntil: "2026-12-04" }); // today + 7 days
    await extendHold(db, r.booking.id, "2026-12-10", { now: NOW });
    await firmTicket(a.ticket.id);
    const [b] = await db.select().from(s.jobBookings).where(eq(s.jobBookings.id, r.booking.id));
    expect(b).toMatchObject({ isTentative: false, holdUntil: null, cancelledAt: null });
    const firm = await db.select().from(s.jobEvents).where(and(eq(s.jobEvents.jobId, a.job.id), eq(s.jobEvents.type, "BOOKING_FIRM")));
    expect(firm[0].message).toMatch(/is now firm: PO PO-/);
  });

  it("find next free slot: earliest valid start across machines, respecting working hours, blocked time and jobs at the same time", async () => {
    const [a, b2] = await acceptedJobs("Sahyadri", [
      { name: "5-axis machining", q: { hours: 5 } },
      { name: "5-axis machining", q: { hours: 4 } },
    ]);
    const m1 = await createMachine(db, { ...EMPTY_MACHINE_FORM, name: "VMC one", deptCode: "PPF" });
    const m2 = await createMachine(db, { ...EMPTY_MACHINE_FORM, name: "VMC two", deptCode: "PPF" });
    await firmTicket(a.ticket.id);
    await bookTime(db, { jobId: a.job.id, machineId: m1.id, start: at("2026-11-30", "09:00"), hours: 5 }, { now: NOW }); // to 14:30
    await blockMachine(db, { machineId: m1.id, type: "MAINTENANCE", start: at("2026-12-01", "00:00"), end: at("2026-12-02", "00:00") });
    await blockMachine(db, { machineId: m2.id, type: "MAINTENANCE", start: at("2026-11-27", "00:00"), end: at("2026-12-03", "00:00") });
    await addHoliday(db, "2026-12-02", "Test holiday");
    const slots = await findFreeSlots(db, [m1.id, m2.id], 4, { from: at("2026-11-30", "09:00") });
    // m1: 30 Nov 14:30 would run into the blocked 1 Dec; 2 Dec is a holiday -> Thu 3 Dec 09:00 to 13:00
    // m2: blocked until 3 Dec -> 3 Dec 09:00 too; the earlier end wins the tie (same), both listed
    expect(slots.map((x) => [x.machine, x.start.toISOString(), x.end.toISOString()])).toEqual([
      ["VMC one", at("2026-12-03", "09:00").toISOString(), at("2026-12-03", "13:00").toISOString()],
      ["VMC two", at("2026-12-03", "09:00").toISOString(), at("2026-12-03", "13:00").toISOString()],
    ]);
    const short = await findFreeSlots(db, [m1.id], 2, { from: at("2026-11-30", "09:00") });
    expect(short[0].start).toEqual(at("2026-11-30", "14:30")); // 2 h fits before the block
    // move a booking to the next free slot on its machine
    const r = await bookTime(db, { jobId: b2.job.id, machineId: m1.id, start: at("2026-11-30", "14:30"), hours: 2 }, { now: NOW });
    await blockMachine(db, { machineId: m1.id, type: "BREAKDOWN", start: at("2026-11-30", "14:00"), end: at("2026-11-30", "18:00") });
    const moved = await moveToNextFreeSlot(db, r.booking.id, { now: NOW });
    expect(moved.start).toEqual(at("2026-12-03", "09:00"));
  });

  it("past bookings need a confirmation; a started booking can't be moved, only its end changed; it can't be removed", async () => {
    const [a] = await acceptedJobs("Sahyadri", [{ name: "5-axis machining", q: { hours: 4 } }]);
    const m = await createMachine(db, { ...EMPTY_MACHINE_FORM, name: "VMC", deptCode: "PPF" });
    await expect(bookTime(db, { jobId: a.job.id, machineId: m.id, start: at("2026-11-26", "10:00"), hours: 4 }, { now: NOW })).rejects.toBeInstanceOf(PastBookingError);
    const r = await bookTime(db, { jobId: a.job.id, machineId: m.id, start: at("2026-11-27", "09:00"), hours: 4 }, { now: NOW });
    const later = at("2026-11-27", "11:00");
    await expect(moveBooking(db, r.booking.id, { start: at("2026-11-30", "09:00") }, { now: later })).rejects.toThrow(/already started, so it can't be moved/);
    const longer = await moveBooking(db, r.booking.id, { hours: 6 }, { now: later });
    expect(longer.end).toEqual(at("2026-11-27", "15:30"));
    await expect(cancelBooking(db, r.booking.id, "Removed", { now: later })).rejects.toThrow(/already started/);
  });

  it("backfill: Paid tickets' jobs are Done; Billing and Payment follow-up are To plan with 'check if work is done'; bulk Mark done clears it", async () => {
    const js = await acceptedJobs("Western", [
      { name: "UTM", q: { samples: 1 } },
      { name: "UTM", q: { samples: 2 } },
      { name: "UTM", q: { samples: 3 } },
      { name: "UTM", q: { samples: 4 } },
    ]);
    await db.execute(sql`delete from job_events`);
    await db.execute(sql`delete from jobs`);
    const stages = ["WAITING_PO", "BILLING", "PAYMENT", "PAID"];
    for (const [i, x] of js.entries()) await db.update(s.tickets).set({ stage: stages[i] as "PAID" }).where(eq(s.tickets.id, x.ticket.id));
    expect((await backfillJobs(db)).created).toBe(4);
    const rows = await db.select({ t: s.tickets.stage, status: s.jobs.status, check: s.jobs.checkWorkDone, id: s.jobs.id }).from(s.jobs).innerJoin(s.tickets, eq(s.tickets.id, s.jobs.ticketId));
    const by = (st: string) => rows.find((r) => r.t === st)!;
    expect([by("WAITING_PO"), by("BILLING"), by("PAYMENT"), by("PAID")].map((r) => [r.status, r.check])).toEqual([
      ["TO_PLAN", false],
      ["TO_PLAN", true],
      ["TO_PLAN", true],
      ["DONE", false],
    ]);
    expect((await backfillJobs(db)).created).toBe(0); // safe to run again
    await expect(bulkMarkDone(db, [by("BILLING").id, by("PAYMENT").id], "ok")).rejects.toThrow(/short completion note/);
    expect(await bulkMarkDone(db, [by("BILLING").id, by("PAYMENT").id, by("PAID").id], "Work was done before planning started")).toBe(2); // the Paid one was already done
    const after = await db.select().from(s.jobs).where(eq(s.jobs.id, by("BILLING").id));
    expect(after[0]).toMatchObject({ status: "DONE", checkWorkDone: false, doneNote: "Work was done before planning started" });
  });
});
