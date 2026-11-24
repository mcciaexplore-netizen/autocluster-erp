/**
 * Booking machine time (brief section 6). Rules:
 * 1. A machine never has more bookings at one moment than its "jobs at the same time".
 * 2. Nothing over blocked time, or on a machine that is Inactive or broken down.
 * 3. A job can have several bookings.
 * 4. Each save locks the machine row (SELECT ... FOR UPDATE), so two people can never book the
 *    same slot at the same moment.
 * 5. A booking that has started can't be moved; only its end (hours) can change.
 * 6. Clashes are refused with a plain message naming the other job and its times.
 * Tickets still waiting for a PO are booked as tentative, held until a date.
 * Kept free of Next.js imports (scripts and tests use it).
 */
import { actorName } from "../lib/auth/actor";
import { and, asc, eq, gt, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { addWorkingHours, dayPlus, formatHours, formatWhen, istDate, maxAtOnce, nextWorkingMoment, overlaps, patternFromSettings, snapTo30, type Span, type WorkPattern } from "@/lib/planning/hours";
import { daysBetween, todayInIndia } from "@/lib/tickets";
import { BLOCK_TYPES } from "@/lib/validation/planning";
import type { DB, Tx } from "./client";
import { addJobEvent, refreshPlanStatus } from "./job-writer";
import { UserFacingError } from "./quote-writer";
import { holidays, jobBookings, jobs, machineBlocks, machines, settings, teamMembers, tickets, type Machine } from "./schema";

type Conn = DB | Tx;

/** Thrown for a start in the past: the screen asks "Book it anyway?" (to record work already done). */
export class PastBookingError extends UserFacingError {
  constructor() {
    super("This time is in the past. Book it anyway, to record work already done?");
    this.name = "PastBookingError";
  }
}

export async function loadPattern(conn: Conn): Promise<{ pattern: WorkPattern; holdDays: number }> {
  const [[s], hs] = await Promise.all([conn.select().from(settings).where(eq(settings.id, 1)), conn.select({ date: holidays.date }).from(holidays)]);
  if (!s) throw new Error("Settings are missing.");
  return { pattern: patternFromSettings(s, hs.map((h) => h.date)), holdDays: s.tentativeHoldDays };
}

/** "Mon 30 Nov, 10:00 to 14:00" (or both full when it crosses days). */
export function formatRange(a: Date, b: Date): string {
  const end = formatWhen(b);
  return istDate(a) === istDate(b) ? `${formatWhen(a)} to ${end.split(", ")[1]}` : `${formatWhen(a)} to ${end}`;
}

/** Bookings and blocked time of one machine around a span. */
async function calendar(conn: Conn, machineId: string, from: Date, to: Date, ignoreBookingId?: string) {
  const [bookings, blocks] = await Promise.all([
    conn
      .select({ id: jobBookings.id, startAt: jobBookings.startAt, endAt: jobBookings.endAt, ticketNo: tickets.ticketNo })
      .from(jobBookings)
      .innerJoin(jobs, eq(jobs.id, jobBookings.jobId))
      .innerJoin(tickets, eq(tickets.id, jobs.ticketId))
      .where(and(eq(jobBookings.machineId, machineId), isNull(jobBookings.cancelledAt), lt(jobBookings.startAt, to), gt(jobBookings.endAt, from), ignoreBookingId ? ne(jobBookings.id, ignoreBookingId) : undefined))
      .orderBy(asc(jobBookings.startAt)),
    conn
      .select()
      .from(machineBlocks)
      .where(and(eq(machineBlocks.machineId, machineId), lt(machineBlocks.startAt, to), gt(machineBlocks.endAt, from)))
      .orderBy(asc(machineBlocks.startAt)),
  ]);
  return { bookings, blocks };
}

/** When a broken-down machine is expected back: the end of its latest breakdown block. */
async function breakdownUntil(conn: Conn, machineId: string): Promise<Date | null> {
  const [b] = await conn
    .select({ endAt: machineBlocks.endAt })
    .from(machineBlocks)
    .where(and(eq(machineBlocks.machineId, machineId), eq(machineBlocks.type, "BREAKDOWN")))
    .orderBy(sql`${machineBlocks.endAt} desc`)
    .limit(1);
  return b?.endAt ?? null;
}

/**
 * Inactive machines take no bookings. A broken-down machine takes bookings only after it is
 * expected back (the breakdown's blocked time refuses anything before); once that time has
 * passed and it's still marked broken down, nothing until someone says it's working again.
 */
async function checkMachineUsable(conn: Conn, m: Machine, now: Date) {
  if (!m.isActive || m.status === "INACTIVE") throw new UserFacingError(`${m.name} is inactive. Choose another machine.`);
  if (m.status === "BREAKDOWN") {
    const until = await breakdownUntil(conn, m.id);
    if (!until || until <= now) throw new UserFacingError(`${m.name} is still marked as broken down. Mark it working again, or extend the breakdown, first.`);
  }
}

/** Refuses a span that goes over blocked time or more jobs than the machine takes at once. */
async function checkFree(conn: Conn, m: Machine, span: Span, ignoreBookingId?: string) {
  const cal = await calendar(conn, m.id, span.start, span.end, ignoreBookingId);
  const block = cal.blocks.find((b) => overlaps({ start: b.startAt, end: b.endAt }, span));
  if (block) throw new UserFacingError(`${m.name} is not available (${BLOCK_TYPES[block.type].toLowerCase()}) from ${formatRange(block.startAt, block.endAt)}.`);
  const spans = cal.bookings.map((b) => ({ start: b.startAt, end: b.endAt }));
  if (maxAtOnce(spans, span) + 1 > m.parallelJobs) {
    const clash = cal.bookings.filter((b) => overlaps({ start: b.startAt, end: b.endAt }, span));
    if (m.parallelJobs === 1) throw new UserFacingError(`${m.name} is already booked for ${clash[0].ticketNo} from ${formatRange(clash[0].startAt, clash[0].endAt)}.`);
    throw new UserFacingError(`${m.name} already has ${m.parallelJobs} jobs at the same time then (${clash.map((c) => c.ticketNo).join(", ")}).`);
  }
}

async function lockJob(tx: Tx, jobId: string) {
  const [j] = await tx
    .select({ job: jobs, ticketNo: tickets.ticketNo, stage: tickets.stage })
    .from(jobs)
    .innerJoin(tickets, eq(tickets.id, jobs.ticketId))
    .where(eq(jobs.id, jobId))
    .for("update", { of: jobs });
  if (!j) throw new UserFacingError("This job could not be found.");
  if (j.job.status === "CANCELLED" || j.stage === "CANCELLED") throw new UserFacingError(`${j.ticketNo} is cancelled, so it can't be booked.`);
  if (j.job.status === "DONE" || j.job.status === "HANDED_OVER") throw new UserFacingError(`${j.ticketNo} is already done.`);
  return j;
}

async function lockMachine(tx: Tx, machineId: string) {
  const [m] = await tx.select().from(machines).where(eq(machines.id, machineId)).for("update");
  if (!m) throw new UserFacingError("That machine could not be found.");
  return m;
}

const checkHours = (h: number) => {
  if (!(h > 0) || h > 2000) throw new UserFacingError("Enter the hours to book, e.g. 4 or 2.5.");
  return Math.round(h * 100) / 100;
};

/** "Finishes 2 days after the promised date" (or null). */
export function lateWarning(end: Date, promisedDate: string | null): string | null {
  if (!promisedDate) return null;
  const late = daysBetween(promisedDate, istDate(end));
  return late > 0 ? `Finishes ${late} ${late === 1 ? "day" : "days"} after the promised date` : null;
}

export interface BookInput {
  jobId: string;
  machineId: string;
  start: Date;
  hours: number;
  operatorId?: string | null;
  note?: string | null;
  /** Booking in the past is allowed only after the person confirms (recording work already done). */
  allowPast?: boolean;
  /** Use the start as given (work starting right now): no snapping, no "in the past" question. */
  exactStart?: boolean;
  createdBy?: string | null;
}

export async function bookTime(db: Conn, input: BookInput, opts: { now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const hours = checkHours(input.hours);
  return db.transaction(async (tx) => {
    const j = await lockJob(tx, input.jobId);
    const m = await lockMachine(tx, input.machineId);
    await checkMachineUsable(tx, m, now);
    const { pattern, holdDays } = await loadPattern(tx);
    // Starts snap to half hours; machines that need an operator start at the next working moment.
    const start = input.exactStart ? input.start : nextWorkingMoment(snapTo30(input.start), pattern, m.runsNonstop);
    if (!input.exactStart && start.getTime() < now.getTime() - 60_000 && !input.allowPast) throw new PastBookingError();
    const end = addWorkingHours(start, hours, pattern, m.runsNonstop);
    await checkFree(tx, m, { start, end });
    let operatorId: string | null = input.operatorId ?? j.job.operatorId ?? null;
    if (operatorId) {
      const [op] = await tx.select({ id: teamMembers.id }).from(teamMembers).where(eq(teamMembers.id, operatorId));
      if (!op) operatorId = null;
    }
    const tentative = j.stage === "WAITING_PO";
    const today = todayInIndia(now);
    const holdUntil = tentative ? dayPlus(today, holdDays) : null;
    const [b] = await tx
      .insert(jobBookings)
      .values({ jobId: input.jobId, machineId: m.id, startAt: start, endAt: end, hours: String(hours), operatorId, isTentative: tentative, holdUntil, note: input.note?.trim() || null, createdBy: input.createdBy ?? (await actorName()) })
      .returning();
    await addJobEvent(
      tx,
      input.jobId,
      "BOOKED",
      `Booked on ${m.name}: ${formatRange(start, end)} (${formatHours(hours)})${tentative ? `, tentative until ${holdUntil!.split("-").reverse().join("/")} (waiting for PO)` : ""}`,
      { bookingId: b.id, machineId: m.id },
      input.createdBy,
    );
    const status = await refreshPlanStatus(tx, input.jobId);
    return { booking: b, machine: m.name, ticketNo: j.ticketNo, status, warning: lateWarning(end, j.job.promisedDate) };
  });
}

/**
 * Moves a booking (another machine, start or hours). A booking that has started can only have
 * its hours (end) changed.
 */
export async function moveBooking(db: Conn, bookingId: string, change: { machineId?: string; start?: Date; hours?: number; allowPast?: boolean }, opts: { now?: Date; by?: string | null } = {}) {
  const now = opts.now ?? new Date();
  return db.transaction(async (tx) => {
    const [b] = await tx.select().from(jobBookings).where(eq(jobBookings.id, bookingId)).for("update");
    if (!b || b.cancelledAt) throw new UserFacingError("That booking could not be found. Please refresh the page.");
    const j = await lockJob(tx, b.jobId);
    const started = b.startAt <= now;
    const machineId = change.machineId ?? b.machineId;
    if (started && (machineId !== b.machineId || (change.start && change.start.getTime() !== b.startAt.getTime())))
      throw new UserFacingError("This booking has already started, so it can't be moved. Only its end can be changed.");
    const m = await lockMachine(tx, machineId);
    await checkMachineUsable(tx, m, now);
    const { pattern } = await loadPattern(tx);
    const hours = checkHours(change.hours ?? Number(b.hours));
    const start = started ? b.startAt : nextWorkingMoment(snapTo30(change.start ?? b.startAt), pattern, m.runsNonstop);
    if (!started && start.getTime() < now.getTime() - 60_000 && !change.allowPast) throw new PastBookingError();
    const end = addWorkingHours(start, hours, pattern, m.runsNonstop);
    if (started && end <= now) throw new UserFacingError("The new end would be in the past. Mark the job done instead, or give it more hours.");
    await checkFree(tx, m, { start, end }, bookingId);
    await tx.update(jobBookings).set({ machineId: m.id, startAt: start, endAt: end, hours: String(hours) }).where(eq(jobBookings.id, bookingId));
    await addJobEvent(tx, b.jobId, "MOVED", `Booking moved to ${m.name}: ${formatRange(start, end)} (${formatHours(hours)})`, { bookingId, from: { machineId: b.machineId, startAt: b.startAt, endAt: b.endAt } }, opts.by);
    await refreshPlanStatus(tx, b.jobId);
    return { machine: m.name, start, end, warning: lateWarning(end, j.job.promisedDate) };
  });
}

/** Removes a booking that hasn't started (also "Release" for a tentative hold). */
export async function cancelBooking(db: Conn, bookingId: string, why: string, opts: { now?: Date; by?: string | null } = {}) {
  const now = opts.now ?? new Date();
  return db.transaction(async (tx) => {
    const [b] = await tx
      .select({ b: jobBookings, machine: machines.name })
      .from(jobBookings)
      .innerJoin(machines, eq(machines.id, jobBookings.machineId))
      .where(eq(jobBookings.id, bookingId))
      .for("update", { of: jobBookings });
    if (!b || b.b.cancelledAt) throw new UserFacingError("That booking could not be found. Please refresh the page.");
    if (b.b.startAt <= now && b.b.endAt > now) throw new UserFacingError("This booking has already started, so it can't be removed. Change its end instead.");
    if (b.b.endAt <= now) throw new UserFacingError("This booking is in the past and is kept for the records.");
    await tx.update(jobBookings).set({ cancelledAt: now }).where(eq(jobBookings.id, bookingId));
    await addJobEvent(tx, b.b.jobId, "UNBOOKED", `${why}: ${b.machine}, ${formatRange(b.b.startAt, b.b.endAt)}`, { bookingId }, opts.by);
    await refreshPlanStatus(tx, b.b.jobId);
    return { machine: b.machine };
  });
}

/** Extends a tentative booking's hold. Expired holds are never deleted by themselves. */
export async function extendHold(db: Conn, bookingId: string, until: string, opts: { now?: Date } = {}) {
  const today = todayInIndia(opts.now ?? new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until) || until < today) throw new UserFacingError("Please choose a date from today on.");
  return db.transaction(async (tx) => {
    const [b] = await tx.select().from(jobBookings).where(eq(jobBookings.id, bookingId)).for("update");
    if (!b || b.cancelledAt) throw new UserFacingError("That booking could not be found. Please refresh the page.");
    if (!b.isTentative) throw new UserFacingError("This booking is already firm.");
    await tx.update(jobBookings).set({ holdUntil: until }).where(eq(jobBookings.id, bookingId));
    await addJobEvent(tx, b.jobId, "HOLD_EXTENDED", `Tentative hold extended to ${until.split("-").reverse().join("/")}`, { bookingId });
    return { holdUntil: until };
  });
}

// ---- Find next free slot ---------------------------------------------------------------------------

export interface Slot {
  machineId: string;
  machine: string;
  start: Date;
  end: Date;
}

/** The earliest start on one machine (at or after `from`) where `hours` fit. */
export async function earliestSlot(conn: Conn, m: Machine, hours: number, from: Date, pattern: WorkPattern, opts: { ignoreBookingId?: string; horizonDays?: number } = {}): Promise<Slot | null> {
  const horizon = new Date(from.getTime() + (opts.horizonDays ?? 120) * 86_400_000);
  const cal = await calendar(conn, m.id, from, horizon, opts.ignoreBookingId);
  const spans = cal.bookings.map((b) => ({ start: b.startAt, end: b.endAt }));
  const blocks = cal.blocks.map((b) => ({ start: b.startAt, end: b.endAt }));
  // The earliest fit starts at `from` or right when something ends (that's when room opens up).
  const halfUp = (d: Date) => new Date(Math.ceil(d.getTime() / 1_800_000) * 1_800_000);
  const candidates = [from, ...spans.map((s) => s.end), ...blocks.map((s) => s.end)].filter((d) => d >= from).sort((a, b) => a.getTime() - b.getTime());
  for (const c of candidates) {
    const start = nextWorkingMoment(halfUp(c), pattern, m.runsNonstop);
    if (start > horizon) break;
    const end = addWorkingHours(start, hours, pattern, m.runsNonstop);
    const span = { start, end };
    if (blocks.some((b) => overlaps(b, span))) continue;
    if (maxAtOnce(spans, span) + 1 > m.parallelJobs) continue;
    return { machineId: m.id, machine: m.name, start, end };
  }
  return null;
}

/** The top options across machines, earliest start first (then earliest end). */
export async function findFreeSlots(conn: Conn, machineIds: string[], hours: number, opts: { from?: Date; limit?: number; ignoreBookingId?: string } = {}): Promise<Slot[]> {
  const h = checkHours(hours);
  const from = opts.from ?? new Date();
  const { pattern } = await loadPattern(conn);
  const ms = machineIds.length ? await conn.select().from(machines).where(inArray(machines.id, machineIds)) : [];
  const usable: Machine[] = [];
  for (const m of ms) {
    if (!m.isActive || m.status === "INACTIVE") continue;
    if (m.status === "BREAKDOWN") {
      const until = await breakdownUntil(conn, m.id);
      if (!until || until <= from) continue; // still broken down after it was expected back
    }
    usable.push(m);
  }
  const slots = (await Promise.all(usable.map((m) => earliestSlot(conn, m, h, from, pattern, { ignoreBookingId: opts.ignoreBookingId })))).filter((s): s is Slot => !!s);
  return slots.sort((a, b) => a.start.getTime() - b.start.getTime() || a.end.getTime() - b.end.getTime()).slice(0, opts.limit ?? 3);
}

/** "Move to next free slot" for a booking that clashes (e.g. with a breakdown): same machine. */
export async function moveToNextFreeSlot(db: Conn, bookingId: string, opts: { now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const [b] = await db.select().from(jobBookings).where(eq(jobBookings.id, bookingId));
  if (!b || b.cancelledAt) throw new UserFacingError("That booking could not be found. Please refresh the page.");
  const [m] = await db.select().from(machines).where(eq(machines.id, b.machineId));
  if (!m.isActive) throw new UserFacingError(`${m.name} is not available. Use “Pick another machine” instead.`);
  if (m.status === "BREAKDOWN") {
    const until = await breakdownUntil(db, m.id);
    if (!until || until <= now) throw new UserFacingError(`${m.name} is still marked as broken down. Use “Pick another machine”, or mark it working again first.`);
  }
  const { pattern } = await loadPattern(db);
  const slot = await earliestSlot(db, m, Number(b.hours), new Date(Math.max(now.getTime(), b.startAt.getTime())), pattern, { ignoreBookingId: bookingId });
  if (!slot) throw new UserFacingError(`No free time on ${m.name} in the next 4 months. Pick another machine.`);
  return moveBooking(db, bookingId, { start: slot.start }, { now });
}

/** Bookings that overlap blocked time on their machine (e.g. after a breakdown was marked). */
export async function bookingsClashingWithBlocks(conn: Conn, now: Date = new Date()) {
  const rows = await conn.execute<{ booking_id: string; job_id: string; ticket_no: string; company: string; machine_id: string; machine: string; start_at: string; end_at: string; block_type: string }>(sql`
    select distinct on (b.id) b.id as booking_id, b.job_id, t.ticket_no, t.snapshot->>'companyName' as company, m.id as machine_id, m.name as machine,
      b.start_at::text, b.end_at::text, k.type as block_type
    from job_bookings b
    join machine_blocks k on k.machine_id = b.machine_id and k.start_at < b.end_at and k.end_at > b.start_at
    join machines m on m.id = b.machine_id
    join jobs j on j.id = b.job_id
    join tickets t on t.id = j.ticket_id
    where b.cancelled_at is null and b.end_at > ${now} and j.status not in ('CANCELLED', 'DONE', 'HANDED_OVER')
    order by b.id, k.start_at`);
  return rows.rows.map((r) => ({ bookingId: r.booking_id, jobId: r.job_id, ticketNo: r.ticket_no, company: r.company, machineId: r.machine_id, machine: r.machine, startAt: new Date(r.start_at), endAt: new Date(r.end_at), blockType: r.block_type as keyof typeof BLOCK_TYPES }));
}
