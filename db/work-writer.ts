/**
 * Operators' work on jobs (brief section 8): Start, Pause (with a reason), Resume, Done,
 * Handed over. Every running period is a time log; actual hours = the logs added up.
 * Kept free of Next.js imports (scripts and tests use it).
 */
import { and, asc, eq, gt, isNull, lte, ne, sql } from "drizzle-orm";
import { formatWhen } from "@/lib/planning/hours";
import { actualHours, PAUSE_REASONS } from "@/lib/planning/work";
import { bookTime, cancelBooking } from "./booking-writer";
import type { DB, Tx } from "./client";
import { addJobEvent } from "./job-writer";
import { UserFacingError } from "./quote-writer";
import { jobBookings, jobs, jobTimeLogs, machines, teamMembers, tickets } from "./schema";

type Conn = DB | Tx;

/** What a person is running right now (shown when a Start is refused, each with a Pause button). */
export interface RunningJob {
  jobId: string;
  ticketNo: string;
  machine: string;
}

/**
 * Start refused because of what the person is already running: at their limit ("You're already
 * running 4 machines (your limit).") or a machine that needs them to stay. Nothing is paused for them.
 */
export class CantStartError extends UserFacingError {
  constructor(
    message: string,
    public running: RunningJob[],
  ) {
    super(message);
    this.name = "CantStartError";
  }
}

const shortNo = (ticketNo: string) => ticketNo.split("/").pop() ?? ticketNo;
const machineWord = (n: number) => `${n} machine${n === 1 ? "" : "s"}`;

/**
 * Someone may run several machines at once (within their departments):
 * - up to their limit (Settings > Planning "Machines one person can run at once", or their own number);
 * - day-and-night machines run on their own once started: they never count toward the limit;
 * - a machine that "Needs the operator to stay" can't be run alongside anything else (both ways).
 * Several jobs on the same machine count as one machine.
 */
export function checkCanStart(
  starting: { machineId: string; machine: string; runsNonstop: boolean; operatorMustStay: boolean },
  others: (RunningJob & { machineId: string | null; runsNonstop: boolean; operatorMustStay: boolean })[],
  limit: number,
) {
  // Day-and-night jobs keep running on their own: they never hold the person at a machine or count.
  const attended = others.filter((o) => !o.runsNonstop);
  const stay = attended.find((o) => o.operatorMustStay);
  if (stay) throw new CantStartError(`${stay.machine} needs you to stay at the machine while ${shortNo(stay.ticketNo)} is running. Pause or finish it first.`, attended);
  if (starting.runsNonstop) return;
  const elsewhere = attended.filter((o) => o.machineId !== starting.machineId);
  if (starting.operatorMustStay && elsewhere.length)
    throw new CantStartError(`${starting.machine} needs you to stay at the machine, and you're running ${elsewhere.map((o) => shortNo(o.ticketNo)).join(", ")}. Pause ${elsewhere.length === 1 ? "it" : "them"} first.`, elsewhere);
  const machinesRunning = new Set(elsewhere.map((o) => o.machineId ?? o.jobId)).size;
  if (machinesRunning >= limit) throw new CantStartError(`You're already running ${machineWord(machinesRunning)} (your limit).`, elsewhere);
}

/** The person's limit: their own number, or the Settings > Planning one. */
async function machineLimit(conn: Conn, operatorId: string) {
  const r = await conn.execute<{ n: number }>(sql`
    select coalesce((select max_machines from app_users where team_member_id = ${operatorId}), (select max_machines_per_person from settings where id = 1), 4)::int as n`);
  return Number(r.rows[0]?.n ?? 4);
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
 * Start pressed with no booking covering now: the screen asks which machine is being used (and
 * whether to remove the job's later booking, since the work is happening now).
 */
export class NeedMachineError extends UserFacingError {
  constructor(
    public info: {
      suggestedMachineId: string | null;
      machines: { id: string; name: string; deptCode: string; suitable: boolean }[];
      hours: number;
      later: { bookingId: string; machine: string; start: Date } | null;
    },
  ) {
    super("Which machine are you using?");
    this.name = "NeedMachineError";
  }
}

/**
 * Start (or Resume) a job. Starting never pauses anything else: what the person may run at once
 * is checked by checkCanStart (CantStartError lists what they're running, to pause by hand).
 * With no booking covering now, a machine must be given (NeedMachineError asks for it): a booking
 * starting now is made on it for the remaining time needed, with the normal clash rules, and the
 * job's later booking can be removed. Time logs always point to the booking they ran in.
 */
export async function startJob(
  db: Conn,
  jobId: string,
  opts: { operatorId: string | null; machineId?: string | null; removeLaterBookingId?: string | null; now?: Date },
) {
  const now = opts.now ?? new Date();
  return db.transaction(async (tx) => {
    const j = await lockJob(tx, jobId);
    if (j.job.status === "RUNNING") throw new UserFacingError(`${j.ticketNo} is already running.`);
    if (j.job.status === "DONE" || j.job.status === "HANDED_OVER") throw new UserFacingError(`${j.ticketNo} is already done.`);
    const who = await operatorName(tx, opts.operatorId);
    const bookings = await tx
      .select({ id: jobBookings.id, machineId: jobBookings.machineId, startAt: jobBookings.startAt, endAt: jobBookings.endAt, hours: jobBookings.hours, machine: machines.name })
      .from(jobBookings)
      .innerJoin(machines, eq(machines.id, jobBookings.machineId))
      .where(and(eq(jobBookings.jobId, jobId), isNull(jobBookings.cancelledAt)))
      .orderBy(asc(jobBookings.startAt));
    let current: { id: string; machineId: string; machine: string } | null = bookings.find((b) => b.startAt <= now && b.endAt > now) ?? null;
    if (!current) {
      const later = bookings.find((b) => b.startAt > now) ?? null;
      const logs = await tx.select().from(jobTimeLogs).where(eq(jobTimeLogs.jobId, jobId));
      const done = actualHours(logs, now);
      const needed = j.job.hoursNeeded != null ? Number(j.job.hoursNeeded) : null;
      const hours = Math.max(0.5, Math.round(((needed != null ? needed - done : later ? Number(later.hours) : 1) || 1) * 2) / 2);
      if (!opts.machineId) {
        const suitable = await tx.execute<{ machine_id: string }>(sql`
          select ms.machine_id from machine_services ms join quotation_items qi on qi.service_id = ms.service_id join tickets t on t.quotation_item_id = qi.id where t.id = ${j.job.ticketId}`);
        const ids = new Set(suitable.rows.map((r) => r.machine_id));
        const all = await tx.select({ id: machines.id, name: machines.name, deptCode: machines.deptCode }).from(machines).where(eq(machines.isActive, true)).orderBy(asc(machines.deptCode), asc(machines.sortOrder));
        const list = all.map((m) => ({ ...m, suitable: ids.has(m.id) })).sort((a, b) => Number(b.suitable) - Number(a.suitable));
        throw new NeedMachineError({
          suggestedMachineId: later?.machineId ?? list.find((m) => m.suitable)?.id ?? null,
          machines: list,
          hours,
          later: later ? { bookingId: later.id, machine: later.machine, start: later.startAt } : null,
        });
      }
      if (opts.removeLaterBookingId) {
        const l = bookings.find((b) => b.id === opts.removeLaterBookingId && b.startAt > now);
        if (l) await cancelBooking(tx, l.id, "Later booking removed: the work started now instead", { now, by: who });
      }
      // The normal clash rules: refused (and not started) if the machine is booked by another job now.
      const r = await bookTime(tx, { jobId, machineId: opts.machineId, start: now, hours, operatorId: opts.operatorId, exactStart: true, note: "Booked when the work started", createdBy: who }, { now });
      current = { id: r.booking.id, machineId: r.booking.machineId, machine: r.machine };
    }
    const [mc] = await tx
      .select({ name: machines.name, runsNonstop: machines.runsNonstop, operatorMustStay: machines.operatorMustStay, parallelJobs: machines.parallelJobs })
      .from(machines)
      .where(eq(machines.id, current.machineId));
    // The machine's "Jobs at the same time" still holds.
    const onMachine = await tx
      .select({ jobId: jobTimeLogs.jobId })
      .from(jobTimeLogs)
      .where(and(eq(jobTimeLogs.machineId, current.machineId), isNull(jobTimeLogs.endedAt), ne(jobTimeLogs.jobId, jobId)));
    const jobsOn = new Set(onMachine.map((r) => r.jobId)).size;
    if (mc && jobsOn >= mc.parallelJobs)
      throw new UserFacingError(`${mc.name} is already running ${jobsOn} job${jobsOn === 1 ? "" : "s"}, as many as it can run at the same time.`);
    if (opts.operatorId && mc) {
      const others = await tx
        .select({ jobId: jobTimeLogs.jobId, ticketNo: tickets.ticketNo, machineId: jobTimeLogs.machineId, machine: sql<string>`coalesce(${machines.name}, 'No machine')`, runsNonstop: sql<boolean>`coalesce(${machines.runsNonstop}, false)`, operatorMustStay: sql<boolean>`coalesce(${machines.operatorMustStay}, false)` })
        .from(jobTimeLogs)
        .innerJoin(jobs, eq(jobs.id, jobTimeLogs.jobId))
        .innerJoin(tickets, eq(tickets.id, jobs.ticketId))
        .leftJoin(machines, eq(machines.id, jobTimeLogs.machineId))
        .where(and(eq(jobTimeLogs.operatorId, opts.operatorId), isNull(jobTimeLogs.endedAt), ne(jobTimeLogs.jobId, jobId)))
        .orderBy(asc(jobTimeLogs.startedAt));
      checkCanStart({ machineId: current.machineId, machine: mc.name, runsNonstop: mc.runsNonstop, operatorMustStay: mc.operatorMustStay }, others, await machineLimit(tx, opts.operatorId));
    }
    const resume = j.job.status === "ON_HOLD";
    await tx.insert(jobTimeLogs).values({ jobId, bookingId: current.id, machineId: current.machineId, operatorId: opts.operatorId, startedAt: now });
    await tx.update(jobs).set({ status: "RUNNING", holdReason: null }).where(eq(jobs.id, jobId));
    await addJobEvent(tx, jobId, resume ? "RESUMED" : "STARTED", `${resume ? "Resumed" : "Started"} on ${current.machine}${who ? ` by ${who}` : ""}`, { bookingId: current.id }, who);
    return { ticketNo: j.ticketNo, machine: current.machine };
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
