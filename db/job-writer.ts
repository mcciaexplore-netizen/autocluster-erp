/**
 * Jobs follow tickets (brief section 5.1): one job per ticket, using the ticket number.
 * Opened when tickets open, cancelled with their ticket (bookings freed), reopened with it,
 * and tentative bookings become firm when the PO is saved. Every change is logged.
 * Kept free of Next.js imports (scripts and tests use it). Must not import ticket-writer.
 */
import { actorName, reportActivity } from "../lib/auth/actor";
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { formatWhen } from "@/lib/planning/hours";
import { suggestHours, type UnitTypeName } from "@/lib/planning/time-needed";
import type { DB, Tx } from "./client";
import { UserFacingError } from "./quote-writer";
import { jobBookings, jobEvents, jobs, jobTimeLogs, machines, quotationItems, services, tickets } from "./schema";

type Conn = DB | Tx;

export async function addJobEvent(conn: Conn, jobId: string, type: string, message: string, data?: Record<string, unknown>, createdBy?: string | null) {
  await conn.insert(jobEvents).values({ jobId, type, message, data: data ?? null, createdBy: createdBy ?? (await actorName()) });
  await reportActivity(conn, { area: "Planning", action: type.toLowerCase().replace(/_/g, " "), summary: message, entityType: "job", entityId: jobId });
}

/** The suggested "time needed" for a ticket: billable hours, or the service's time settings. */
async function suggestedHoursFor(conn: Conn, ticketIds: string[]) {
  const rows = await conn
    .select({ ticketId: tickets.id, billable: quotationItems.billableQty, unitType: quotationItems.unitType, custom: quotationItems.isCustomItem, setup: services.setupMinutes, per: services.minutesPerUnit })
    .from(tickets)
    .innerJoin(quotationItems, eq(quotationItems.id, tickets.quotationItemId))
    .leftJoin(services, eq(services.id, quotationItems.serviceId))
    .where(inArray(tickets.id, ticketIds));
  return new Map(
    rows.map((r) => [
      r.ticketId,
      suggestHours({ unitType: r.custom ? null : (r.unitType as UnitTypeName | null), billableQty: Number(r.billable), setupMinutes: r.setup, minutesPerUnit: r.per }),
    ]),
  );
}

/**
 * Makes sure every given ticket has a job: new tickets get one in "To plan"; a cancelled job whose
 * ticket was reopened goes back to "To plan". Safe to run many times.
 */
export async function ensureJobsForTickets(conn: Conn, ticketIds: string[], opts: { invoicedAreDone?: boolean } = {}) {
  if (!ticketIds.length) return { created: 0, reopened: 0 };
  const ts = await conn.select({ id: tickets.id, ticketNo: tickets.ticketNo, stage: tickets.stage }).from(tickets).where(inArray(tickets.id, ticketIds));
  const have = await conn.select().from(jobs).where(inArray(jobs.ticketId, ticketIds));
  const hours = await suggestedHoursFor(conn, ticketIds);
  let created = 0;
  let reopened = 0;
  for (const t of ts) {
    if (t.stage === "CANCELLED") continue;
    const j = have.find((x) => x.ticketId === t.id);
    if (!j) {
      const h = hours.get(t.id);
      // Backfill: a Paid ticket was worked on before Planning started; Billing / Payment follow-up
      // tickets are probably done too, so they're flagged "check if work is done".
      const done = !!opts.invoicedAreDone && t.stage === "PAID";
      const check = !!opts.invoicedAreDone && (t.stage === "BILLING" || t.stage === "PAYMENT");
      const [row] = await conn
        .insert(jobs)
        .values({ ticketId: t.id, status: done ? "DONE" : "TO_PLAN", hoursNeeded: h == null ? null : String(h), checkWorkDone: check, ...(done ? { doneNote: "Done before Planning started" } : {}) })
        .onConflictDoNothing({ target: jobs.ticketId })
        .returning({ id: jobs.id });
      if (row) {
        created++;
        await addJobEvent(
          conn,
          row.id,
          "OPENED",
          done
            ? `Job added for ticket ${t.ticketNo}: already paid, so marked Done (done before Planning started)`
            : check
              ? `Job added for ticket ${t.ticketNo}: invoiced before planning started, check if the work is done`
              : `Job opened from ticket ${t.ticketNo}${h != null ? `: about ${h} h needed` : ""}`,
        );
      }
    } else if (j.status === "CANCELLED") {
      await conn.update(jobs).set({ status: "TO_PLAN" }).where(eq(jobs.id, j.id));
      await refreshPlanStatus(conn, j.id);
      await addJobEvent(conn, j.id, "REOPENED", `Job reopened: ticket ${t.ticketNo} reopened`);
      reopened++;
    }
  }
  return { created, reopened };
}

/** Cancels the jobs of cancelled tickets and frees their bookings (those not over yet). */
export async function cancelJobsForTickets(conn: Conn, ticketIds: string[], reason: string, now: Date = new Date()) {
  if (!ticketIds.length) return 0;
  const js = await conn.select({ id: jobs.id, status: jobs.status }).from(jobs).where(inArray(jobs.ticketId, ticketIds));
  let n = 0;
  for (const j of js) {
    if (j.status === "CANCELLED") continue;
    const freed = await conn
      .update(jobBookings)
      .set({ cancelledAt: now })
      .where(and(eq(jobBookings.jobId, j.id), isNull(jobBookings.cancelledAt), gt(jobBookings.endAt, now)))
      .returning({ id: jobBookings.id });
    await conn.update(jobTimeLogs).set({ endedAt: now }).where(and(eq(jobTimeLogs.jobId, j.id), isNull(jobTimeLogs.endedAt)));
    await conn.update(jobs).set({ status: "CANCELLED" }).where(eq(jobs.id, j.id));
    await addJobEvent(conn, j.id, "CANCELLED", `Job cancelled: ${reason}${freed.length ? `. ${freed.length} ${freed.length === 1 ? "booking" : "bookings"} freed` : ""}`);
    n++;
  }
  return n;
}

/** When the PO is saved, the tickets' tentative bookings become firm (with a history line). */
export async function firmUpBookingsForTickets(conn: Conn, ticketIds: string[], poNumber: string) {
  if (!ticketIds.length) return 0;
  const rows = await conn
    .select({ id: jobBookings.id, jobId: jobBookings.jobId, startAt: jobBookings.startAt, machine: machines.name })
    .from(jobBookings)
    .innerJoin(jobs, eq(jobs.id, jobBookings.jobId))
    .innerJoin(machines, eq(machines.id, jobBookings.machineId))
    .where(and(inArray(jobs.ticketId, ticketIds), eq(jobBookings.isTentative, true), isNull(jobBookings.cancelledAt)));
  for (const b of rows) {
    await conn.update(jobBookings).set({ isTentative: false, holdUntil: null }).where(eq(jobBookings.id, b.id));
    await addJobEvent(conn, b.jobId, "BOOKING_FIRM", `Booking on ${b.machine} (${formatWhen(b.startAt)}) is now firm: PO ${poNumber} received`, { bookingId: b.id });
  }
  return rows.length;
}

/**
 * "To plan" or "Planned", from the bookings: Planned once the booked hours cover the time needed
 * (or, with no time needed set, once there is any booking). Other statuses are left alone.
 */
export async function refreshPlanStatus(conn: Conn, jobId: string) {
  const [j] = await conn.select({ status: jobs.status, needed: jobs.hoursNeeded }).from(jobs).where(eq(jobs.id, jobId));
  if (!j || (j.status !== "TO_PLAN" && j.status !== "PLANNED")) return j?.status;
  const [{ planned }] = (await conn.execute<{ planned: string | null }>(sql`select sum(hours) as planned from job_bookings where job_id = ${jobId} and cancelled_at is null`)).rows;
  const p = Number(planned ?? 0);
  const next = p > 0 && (j.needed == null || p >= Number(j.needed) - 0.001) ? "PLANNED" : "TO_PLAN";
  if (next !== j.status) await conn.update(jobs).set({ status: next }).where(eq(jobs.id, jobId));
  return next;
}

export interface JobDetailsInput {
  hoursNeeded: number | null;
  promisedDate: string | null;
  priority: "NORMAL" | "URGENT";
  operatorId: string | null;
  instructions: string | null;
}

/** Saves a job's details (time needed, promised date, priority, operator, instructions). */
export async function updateJobDetails(db: Conn, jobId: string, v: JobDetailsInput, by?: string | null) {
  if (v.hoursNeeded != null && !(v.hoursNeeded > 0 && v.hoursNeeded <= 5000)) throw new UserFacingError("Enter the time needed in hours, e.g. 6 or 2.5.");
  if (v.promisedDate && !/^\d{4}-\d{2}-\d{2}$/.test(v.promisedDate)) throw new UserFacingError("Please choose the promised date.");
  return db.transaction(async (tx) => {
    const [j] = await tx.select().from(jobs).where(eq(jobs.id, jobId)).for("update");
    if (!j) throw new UserFacingError("This job could not be found.");
    if (j.status === "CANCELLED") throw new UserFacingError("This job is cancelled.");
    const changes: string[] = [];
    const h = v.hoursNeeded == null ? null : String(Math.round(v.hoursNeeded * 100) / 100);
    if (Number(j.hoursNeeded ?? -1) !== Number(h ?? -1)) changes.push(`time needed ${h == null ? "cleared" : `${Number(h)} h`}`);
    if ((j.promisedDate ?? null) !== (v.promisedDate || null)) changes.push(`promised date ${v.promisedDate ? v.promisedDate.split("-").reverse().join("/") : "cleared"}`);
    if (j.priority !== v.priority) changes.push(v.priority === "URGENT" ? "marked Urgent" : "priority Normal");
    if ((j.operatorId ?? null) !== (v.operatorId || null)) changes.push("operator changed");
    if ((j.instructions ?? "") !== (v.instructions?.trim() ?? "")) changes.push("instructions updated");
    await tx
      .update(jobs)
      .set({ hoursNeeded: h, promisedDate: v.promisedDate || null, priority: v.priority, operatorId: v.operatorId || null, instructions: v.instructions?.trim() || null })
      .where(eq(jobs.id, jobId));
    await refreshPlanStatus(tx, jobId);
    if (changes.length) await addJobEvent(tx, jobId, "DETAILS", `Details changed: ${changes.join(", ")}`, undefined, by);
    return { changed: changes.length };
  });
}

/** Bulk: set the operator or priority of several jobs. */
export async function bulkUpdateJobs(db: Conn, jobIds: string[], v: { operatorId?: string | null; priority?: "NORMAL" | "URGENT" }) {
  if (!jobIds.length) throw new UserFacingError("Please tick at least one job.");
  return db.transaction(async (tx) => {
    const set: Partial<typeof jobs.$inferInsert> = {};
    if (v.operatorId !== undefined) set.operatorId = v.operatorId;
    if (v.priority) set.priority = v.priority;
    const rows = await tx.update(jobs).set(set).where(and(inArray(jobs.id, jobIds), sql`${jobs.status} <> 'CANCELLED'`)).returning({ id: jobs.id });
    for (const r of rows) await addJobEvent(tx, r.id, "DETAILS", v.priority ? `Priority set to ${v.priority === "URGENT" ? "Urgent" : "Normal"}` : "Operator changed (several jobs at once)");
    return rows.length;
  });
}

/** Bulk "Mark done" (Jobs list): one completion note for all the selected jobs. */
export async function bulkMarkDone(db: Conn, jobIds: string[], note: string, opts: { now?: Date; by?: string | null } = {}) {
  const n = note.trim();
  if (n.length < 3) throw new UserFacingError("Please write a short completion note, e.g. “Work was done before planning started”.");
  if (!jobIds.length) throw new UserFacingError("Please tick at least one job.");
  const now = opts.now ?? new Date();
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(jobs)
      .set({ status: "DONE", doneAt: now, doneNote: n, checkWorkDone: false, holdReason: null })
      .where(and(inArray(jobs.id, jobIds), sql`${jobs.status} not in ('DONE', 'HANDED_OVER', 'CANCELLED')`))
      .returning({ id: jobs.id });
    for (const r of rows) {
      await tx.update(jobTimeLogs).set({ endedAt: now }).where(and(eq(jobTimeLogs.jobId, r.id), isNull(jobTimeLogs.endedAt)));
      // future bookings are no longer needed
      await tx.update(jobBookings).set({ cancelledAt: now }).where(and(eq(jobBookings.jobId, r.id), isNull(jobBookings.cancelledAt), gt(jobBookings.startAt, now)));
      await addJobEvent(tx, r.id, "DONE", `Marked done (several jobs at once): ${n}`, undefined, opts.by);
    }
    return rows.length;
  });
}

/** Creates jobs for open tickets that have none (`npm run jobs:backfill`). Safe to run many times. */
export async function backfillJobs(db: DB) {
  const open = await db.select({ id: tickets.id }).from(tickets).where(sql`${tickets.stage} <> 'CANCELLED' and not exists (select 1 from jobs j where j.ticket_id = ${tickets.id})`);
  return db.transaction((tx) => ensureJobsForTickets(tx, open.map((t) => t.id), { invoicedAreDone: true }));
}
