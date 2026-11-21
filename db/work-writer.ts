/**
 * Operators' work on jobs (brief section 8): Start, Pause (with a reason), Resume, Done,
 * Handed over. Every running period is a time log; actual hours = the logs added up.
 * Kept free of Next.js imports (scripts and tests use it).
 */
import { and, asc, eq, gt, isNull, lte, ne, sql } from "drizzle-orm";
import { formatWhen } from "@/lib/planning/hours";
import { PAUSE_REASONS } from "@/lib/planning/work";
import type { DB, Tx } from "./client";
import { addJobEvent } from "./job-writer";
import { UserFacingError } from "./quote-writer";
import { jobBookings, jobs, jobTimeLogs, machines, teamMembers, tickets } from "./schema";

type Conn = DB | Tx;

/** Start refused because this operator is already running another job (the screen offers to pause it). */
export class OtherJobRunningError extends UserFacingError {
  constructor(
    public otherJobId: string,
    public otherTicketNo: string,
  ) {
    super(`You're already running ${otherTicketNo}. Pause it and start this one?`);
    this.name = "OtherJobRunningError";
  }
}

async function lockJob(tx: Tx, jobId: string) {
  const [r] = await tx
    .select({ job: jobs, ticketNo: tickets.ticketNo, stage: tickets.stage })
    .from(jobs)
    .innerJoin(tickets, eq(tickets.id, jobs.ticketId))
    .where(eq(jobs.id, jobId))
    .for("update", { of: jobs });
  if (!r) throw new UserFacingError("This job could not be found.");
  if (r.job.status === "CANCELLED" || r.stage === "CANCELLED") throw new UserFacingError(`${r.ticketNo} is cancelled.`);
  return r;
}

async function operatorName(conn: Conn, operatorId: string | null) {
  if (!operatorId) return null;
  const [m] = await conn.select({ name: teamMembers.name }).from(teamMembers).where(eq(teamMembers.id, operatorId));
  return m?.name ?? null;
}

/** Closes the open running period of a job (if any). */
async function closeLog(tx: Tx, jobId: string, now: Date, pauseReason: string | null) {
  return tx
    .update(jobTimeLogs)
    .set({ endedAt: now, pauseReason })
    .where(and(eq(jobTimeLogs.jobId, jobId), isNull(jobTimeLogs.endedAt)))
    .returning();
}

/**
 * Start (or Resume) a job. Only one running job per operator: if another is running, it is
 * refused (OtherJobRunningError) unless `pauseOther` is set, which pauses that one first.
 */
export async function startJob(db: Conn, jobId: string, opts: { operatorId: string | null; pauseOther?: boolean; now?: Date }) {
  const now = opts.now ?? new Date();
  return db.transaction(async (tx) => {
    const j = await lockJob(tx, jobId);
    if (j.job.status === "RUNNING") throw new UserFacingError(`${j.ticketNo} is already running.`);
    if (j.job.status === "DONE" || j.job.status === "HANDED_OVER") throw new UserFacingError(`${j.ticketNo} is already done.`);
    const who = await operatorName(tx, opts.operatorId);
    if (opts.operatorId) {
      const [other] = await tx
        .select({ jobId: jobTimeLogs.jobId, ticketNo: tickets.ticketNo })
        .from(jobTimeLogs)
        .innerJoin(jobs, eq(jobs.id, jobTimeLogs.jobId))
        .innerJoin(tickets, eq(tickets.id, jobs.ticketId))
        .where(and(eq(jobTimeLogs.operatorId, opts.operatorId), isNull(jobTimeLogs.endedAt), ne(jobTimeLogs.jobId, jobId)))
        .limit(1);
      if (other) {
        if (!opts.pauseOther) throw new OtherJobRunningError(other.jobId, other.ticketNo);
        await pauseInTx(tx, other.jobId, "Other", `Started ${j.ticketNo}`, now, who);
      }
    }
    // The booking being worked on: the one covering now on any machine, else the next one today, else the last.
    const bookings = await tx
      .select({ id: jobBookings.id, machineId: jobBookings.machineId, startAt: jobBookings.startAt, endAt: jobBookings.endAt, machine: machines.name })
      .from(jobBookings)
      .innerJoin(machines, eq(machines.id, jobBookings.machineId))
      .where(and(eq(jobBookings.jobId, jobId), isNull(jobBookings.cancelledAt)))
      .orderBy(asc(jobBookings.startAt));
    const current = bookings.find((b) => b.startAt <= now && b.endAt > now) ?? bookings.find((b) => b.startAt > now) ?? bookings.at(-1) ?? null;
    const resume = j.job.status === "ON_HOLD";
    await tx.insert(jobTimeLogs).values({ jobId, bookingId: current?.id ?? null, machineId: current?.machineId ?? null, operatorId: opts.operatorId, startedAt: now });
    await tx.update(jobs).set({ status: "RUNNING", holdReason: null }).where(eq(jobs.id, jobId));
    await addJobEvent(tx, jobId, resume ? "RESUMED" : "STARTED", `${resume ? "Resumed" : "Started"}${current ? ` on ${current.machine}` : ""}${who ? ` by ${who}` : ""}`, { bookingId: current?.id ?? null }, who);
    return { ticketNo: j.ticketNo, machine: current?.machine ?? null };
  });
}

async function pauseInTx(tx: Tx, jobId: string, reason: string, note: string | null, now: Date, who: string | null) {
  const why = note?.trim() ? (reason === "Other" ? note.trim() : `${reason}: ${note.trim()}`) : reason;
  await closeLog(tx, jobId, now, why);
  await tx.update(jobs).set({ status: "ON_HOLD", holdReason: why }).where(eq(jobs.id, jobId));
  await addJobEvent(tx, jobId, "PAUSED", `Paused: ${why}`, undefined, who);
}

/** Pause: on hold, with a reason (Waiting for customer, Waiting for material, Machine problem, Other). */
export async function pauseJob(db: Conn, jobId: string, reason: string, note: string | null, opts: { operatorId?: string | null; now?: Date } = {}) {
  if (!(PAUSE_REASONS as readonly string[]).includes(reason)) throw new UserFacingError("Please choose why the job is paused.");
  if (reason === "Other" && (note?.trim().length ?? 0) < 3) throw new UserFacingError("Please write a short reason.");
  const now = opts.now ?? new Date();
  return db.transaction(async (tx) => {
    const j = await lockJob(tx, jobId);
    if (j.job.status !== "RUNNING") throw new UserFacingError(`${j.ticketNo} isn't running.`);
    await pauseInTx(tx, jobId, reason, note, now, await operatorName(tx, opts.operatorId ?? null));
    return { ticketNo: j.ticketNo };
  });
}

/** "On hold" without having started (e.g. waiting for the customer's drawings). */
export async function holdJob(db: Conn, jobId: string, reason: string, note: string | null, opts: { now?: Date } = {}) {
  if (!(PAUSE_REASONS as readonly string[]).includes(reason)) throw new UserFacingError("Please choose why the job is on hold.");
  return db.transaction(async (tx) => {
    const j = await lockJob(tx, jobId);
    if (!["TO_PLAN", "PLANNED", "RUNNING"].includes(j.job.status)) throw new UserFacingError(`${j.ticketNo} can't be put on hold now.`);
    await pauseInTx(tx, jobId, reason, note, opts.now ?? new Date(), null);
    return { ticketNo: j.ticketNo };
  });
}

export interface DoneInput {
  note: string;
  qtyDone?: string | null;
  problems?: string | null;
  operatorId?: string | null;
}

/**
 * Done: the running period ends, the job is Done. A booking still going ends now (the machine is
 * free again) and bookings not started yet are freed.
 */
export async function finishJob(db: Conn, jobId: string, input: DoneInput, opts: { now?: Date } = {}) {
  const note = input.note.trim();
  if (note.length < 3) throw new UserFacingError("Please write a short completion note, e.g. “All 20 parts printed and cleaned”.");
  const now = opts.now ?? new Date();
  return db.transaction(async (tx) => {
    const j = await lockJob(tx, jobId);
    if (j.job.status === "DONE" || j.job.status === "HANDED_OVER") throw new UserFacingError(`${j.ticketNo} is already done.`);
    const who = await operatorName(tx, input.operatorId ?? null);
    await closeLog(tx, jobId, now, null);
    // Free the machine: a booking still going ends now; later ones are no longer needed.
    await tx.update(jobBookings).set({ endAt: now }).where(and(eq(jobBookings.jobId, jobId), isNull(jobBookings.cancelledAt), lte(jobBookings.startAt, now), gt(jobBookings.endAt, now)));
    await tx.update(jobBookings).set({ cancelledAt: now }).where(and(eq(jobBookings.jobId, jobId), isNull(jobBookings.cancelledAt), gt(jobBookings.startAt, now)));
    const problems = input.problems?.trim() || null;
    const qty = input.qtyDone?.trim() || null;
    await tx
      .update(jobs)
      .set({ status: "DONE", doneAt: now, doneNote: problems ? `${note} (Problems: ${problems})` : note, qtyDone: qty, holdReason: null, checkWorkDone: false })
      .where(eq(jobs.id, jobId));
    await addJobEvent(tx, jobId, "DONE", `Done${who ? ` by ${who}` : ""}: ${note}${qty ? ` · done: ${qty}` : ""}${problems ? ` · problems: ${problems}` : ""}`, undefined, who);
    return { ticketNo: j.ticketNo };
  });
}

/** Handed over: parts or samples given back to the customer. */
export async function handOverJob(db: Conn, jobId: string, date: string, receivedBy: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new UserFacingError("Please choose the date.");
  const to = receivedBy.trim();
  if (to.length < 2) throw new UserFacingError("Please write who received them.");
  return db.transaction(async (tx) => {
    const j = await lockJob(tx, jobId);
    if (j.job.status !== "DONE") throw new UserFacingError(`${j.ticketNo} isn't done yet.`);
    await tx.update(jobs).set({ status: "HANDED_OVER", handedOverAt: date, handedOverTo: to }).where(eq(jobs.id, jobId));
    await addJobEvent(tx, jobId, "HANDED_OVER", `Handed over on ${date.split("-").reverse().join("/")} to ${to}`);
    return { ticketNo: j.ticketNo };
  });
}

/** "Tell the customer it's ready": the WhatsApp message was opened (logged in the history). */
export async function logReadyMessage(db: Conn, jobId: string, phone: string | null) {
  await addJobEvent(db, jobId, "READY_SENT", `Customer told it's ready (WhatsApp${phone ? ` to ${phone}` : ""})`);
}

/** Running jobs and their open period (for "Now: ..." on machines and "Still running?"). */
export async function runningLogs(conn: Conn) {
  return conn.execute<{ job_id: string; machine_id: string | null; operator_id: string | null; started_at: string; ticket_no: string; company: string }>(sql`
    select l.job_id, l.machine_id, l.operator_id, l.started_at::text, t.ticket_no, t.snapshot->>'companyName' as company
    from job_time_logs l join jobs j on j.id = l.job_id join tickets t on t.id = j.ticket_id
    where l.ended_at is null`).then((r) => r.rows);
}

export const formatStarted = (d: Date) => formatWhen(d);
