/**
 * Read-only Planning queries used by pages. Every function calls connection() first,
 * so data is always read fresh at request time (and the build never touches the database).
 */
import "server-only";
import { and, asc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { connection } from "next/server";
import { db } from "@/db";
import { nextMachineCode } from "@/db/machine-writer";
import { departments, holidays, jobBookings, jobs, machineBlocks, machineServices, machines, services, settings, teamMembers, tickets } from "@/db/schema";
import { dayPlus, istAt, istDate, patternFromSettings, type Span, type WorkPattern } from "@/lib/planning/hours";
import { machineUse, weekStart } from "@/lib/planning/use";

/** Working hours and holidays, as a pattern for the working-hours maths. */
export async function getPlanningSettings() {
  await connection();
  const [[s], hs] = await Promise.all([db.select().from(settings).where(eq(settings.id, 1)), db.select().from(holidays).orderBy(asc(holidays.date))]);
  if (!s) throw new Error("Settings are missing. Run: npm run db:seed");
  return {
    settings: s,
    holidays: hs,
    pattern: patternFromSettings(s, hs.map((h) => h.date)),
  };
}
export type PlanningSettings = Awaited<ReturnType<typeof getPlanningSettings>>;

export async function listHolidays() {
  await connection();
  return db.select().from(holidays).orderBy(asc(holidays.date));
}

export async function listDepartments() {
  await connection();
  return db.select({ code: departments.code, name: departments.name }).from(departments).orderBy(asc(departments.sortOrder));
}

/** What the machine form chooses from: departments, the whole rate card, and the next code. */
export async function getMachineFormOptions() {
  await connection();
  const [depts, svcs, nextCode] = await Promise.all([
    db.select({ code: departments.code, name: departments.name }).from(departments).orderBy(asc(departments.sortOrder)),
    db.select({ id: services.id, name: services.name, deptCode: services.deptCode, unitLabel: services.unitLabel, isActive: services.isActive }).from(services).orderBy(asc(services.sortOrder)),
    nextMachineCode(db),
  ]);
  return { departments: depts, services: svcs, nextCode };
}
export type MachineFormOptions = Awaited<ReturnType<typeof getMachineFormOptions>>;

type BookingRow = { id: string; machineId: string; jobId: string; startAt: Date; endAt: Date; hours: string; isTentative: boolean; holdUntil: string | null; ticketNo: string; company: string; service: string; jobStatus: string };

async function bookingsBetween(from: Date, to: Date, machineId?: string): Promise<BookingRow[]> {
  return db
    .select({
      id: jobBookings.id,
      machineId: jobBookings.machineId,
      jobId: jobBookings.jobId,
      startAt: jobBookings.startAt,
      endAt: jobBookings.endAt,
      hours: jobBookings.hours,
      isTentative: jobBookings.isTentative,
      holdUntil: jobBookings.holdUntil,
      ticketNo: tickets.ticketNo,
      company: sql<string>`${tickets.snapshot}->>'companyName'`,
      service: sql<string>`${tickets.snapshot}->>'description'`,
      jobStatus: jobs.status,
    })
    .from(jobBookings)
    .innerJoin(jobs, eq(jobs.id, jobBookings.jobId))
    .innerJoin(tickets, eq(tickets.id, jobs.ticketId))
    .where(and(isNull(jobBookings.cancelledAt), lt(jobBookings.startAt, to), gt(jobBookings.endAt, from), machineId ? eq(jobBookings.machineId, machineId) : undefined))
    .orderBy(asc(jobBookings.startAt));
}

async function blocksBetween(from: Date, to: Date, machineId?: string) {
  return db
    .select()
    .from(machineBlocks)
    .where(and(lt(machineBlocks.startAt, to), gt(machineBlocks.endAt, from), machineId ? eq(machineBlocks.machineId, machineId) : undefined))
    .orderBy(asc(machineBlocks.startAt));
}

/** The India week (Monday to Monday) holding a date. */
export function weekWindow(date: string): Span & { from: string } {
  const from = weekStart(date);
  return { from, start: istAt(from, 0), end: istAt(dayPlus(from, 7), 0) };
}
function monthWindow(date: string): Span {
  const first = `${date.slice(0, 7)}-01`;
  const next = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 1)).toISOString().slice(0, 10);
  return { start: istAt(first, 0), end: istAt(next, 0) };
}

function machineUseFor(m: { id: string; runsNonstop: boolean; parallelJobs: number }, window: Span, pattern: WorkPattern, bookings: BookingRow[], blocks: { machineId: string; startAt: Date; endAt: Date }[]) {
  return machineUse({
    window,
    pattern,
    nonstop: m.runsNonstop,
    parallelJobs: m.parallelJobs,
    blocks: blocks.filter((b) => b.machineId === m.id).map((b) => ({ start: b.startAt, end: b.endAt })),
    bookings: bookings.filter((b) => b.machineId === m.id).map((b) => ({ start: b.startAt, end: b.endAt })),
  });
}

/** Machines with their services, what's running now, the next booking and use % this week. */
export async function listMachines() {
  await connection();
  const now = new Date();
  const week = weekWindow(istDate(now));
  const [plan, rows, links, depts, weekBookings, weekBlocks, upcoming, blockedNow] = await Promise.all([
    getPlanningSettings(),
    db.select().from(machines).orderBy(asc(machines.sortOrder), asc(machines.name)),
    db.select({ machineId: machineServices.machineId, serviceId: services.id, name: services.name }).from(machineServices).innerJoin(services, eq(services.id, machineServices.serviceId)),
    db.select().from(departments).orderBy(asc(departments.sortOrder)),
    bookingsBetween(week.start, week.end),
    blocksBetween(week.start, week.end),
    bookingsBetween(now, new Date(now.getTime() + 120 * 86_400_000)),
    blocksBetween(now, new Date(now.getTime() + 1)),
  ]);
  const list = rows.map((m) => {
    const mine = upcoming.filter((b) => b.machineId === m.id);
    return {
      ...m,
      services: links.filter((l) => l.machineId === m.id).map((l) => ({ id: l.serviceId, name: l.name })),
      now: mine.filter((b) => b.startAt <= now && b.endAt > now),
      next: mine.find((b) => b.startAt > now) ?? null,
      blockedNow: blockedNow.find((b) => b.machineId === m.id) ?? null,
      use: machineUseFor(m, week, plan.pattern, weekBookings, weekBlocks),
    };
  });
  return { departments: depts, machines: list };
}
export type MachineListRow = Awaited<ReturnType<typeof listMachines>>["machines"][number];

/** One machine: its week (bookings and blocked time), use %, services and job history. */
export async function getMachine(id: string, weekOf?: string) {
  await connection();
  const [m] = await db.select().from(machines).where(eq(machines.id, id));
  if (!m) return null;
  const now = new Date();
  const week = weekWindow(weekOf && /^\d{4}-\d{2}-\d{2}$/.test(weekOf) ? weekOf : istDate(now));
  const month = monthWindow(istDate(now));
  const thisWeek = weekWindow(istDate(now));
  const [plan, svcs, dept, wb, wbl, mb, mbl, twb, twbl, history] = await Promise.all([
    getPlanningSettings(),
    db.select({ id: services.id, name: services.name, deptCode: services.deptCode }).from(machineServices).innerJoin(services, eq(services.id, machineServices.serviceId)).where(eq(machineServices.machineId, id)).orderBy(asc(services.sortOrder)),
    db.select().from(departments).where(eq(departments.code, m.deptCode)),
    bookingsBetween(week.start, week.end, id),
    blocksBetween(week.start, week.end, id),
    bookingsBetween(month.start, month.end, id),
    blocksBetween(month.start, month.end, id),
    bookingsBetween(thisWeek.start, thisWeek.end, id),
    blocksBetween(thisWeek.start, thisWeek.end, id),
    db
      .select({ jobId: jobs.id, ticketNo: tickets.ticketNo, company: sql<string>`${tickets.snapshot}->>'companyName'`, service: sql<string>`${tickets.snapshot}->>'description'`, status: jobs.status, startAt: sql<Date>`min(${jobBookings.startAt})`, endAt: sql<Date>`max(${jobBookings.endAt})`, operator: sql<string | null>`max(${teamMembers.name})` })
      .from(jobBookings)
      .innerJoin(jobs, eq(jobs.id, jobBookings.jobId))
      .innerJoin(tickets, eq(tickets.id, jobs.ticketId))
      .leftJoin(teamMembers, eq(teamMembers.id, jobBookings.operatorId))
      .where(and(eq(jobBookings.machineId, id), isNull(jobBookings.cancelledAt), lt(jobBookings.startAt, now)))
      .groupBy(jobs.id, tickets.ticketNo, tickets.snapshot, jobs.status)
      .orderBy(sql`min(${jobBookings.startAt}) desc`)
      .limit(50),
  ]);
  return {
    machine: m,
    department: dept[0] ?? null,
    services: svcs,
    week: { from: week.from, bookings: wb, blocks: wbl },
    useWeek: machineUseFor(m, thisWeek, plan.pattern, twb, twbl),
    useMonth: machineUseFor(m, month, plan.pattern, mb, mbl),
    history: history.map((h) => ({ ...h, startAt: new Date(h.startAt), endAt: new Date(h.endAt) })),
    pattern: plan.pattern,
  };
}
export type MachineDetail = NonNullable<Awaited<ReturnType<typeof getMachine>>>;

/** Active machines for pickers (block time etc.). */
export async function getMachinePicks() {
  await connection();
  return db
    .select({ id: machines.id, name: machines.name, code: machines.code, deptCode: machines.deptCode, status: machines.status })
    .from(machines)
    .where(eq(machines.isActive, true))
    .orderBy(asc(machines.deptCode), asc(machines.sortOrder), asc(machines.name));
}
