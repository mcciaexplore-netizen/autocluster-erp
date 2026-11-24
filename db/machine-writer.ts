/**
 * Machines, blocked time ("machine not available"), breakdowns and holidays (brief sections 3-4).
 * Kept free of Next.js imports so scripts and tests can use it.
 */
import { actorName } from "../lib/auth/actor";
import { and, asc, eq, gt, isNull, lt, ne, sql } from "drizzle-orm";
import { formatWhen } from "@/lib/planning/hours";
import { BLOCK_TYPES, type BlockTypeName, type MachineFormValues } from "@/lib/validation/planning";
import type { DB, Tx } from "./client";
import { UserFacingError } from "./quote-writer";
import { departments, holidays, jobBookings, jobs, machineBlocks, machineServices, machines, services, tickets } from "./schema";

const clean = (v: string | null | undefined) => {
  const t = (v ?? "").trim();
  return t || null;
};

/** The next free machine code: MC-01, MC-02 ... (numbers typed by hand are skipped). */
export async function nextMachineCode(db: DB | Tx): Promise<string> {
  const rows = await db.select({ code: machines.code }).from(machines);
  const used = new Set(rows.map((r) => r.code.toUpperCase()));
  for (let n = 1; ; n++) {
    const code = `MC-${String(n).padStart(2, "0")}`;
    if (!used.has(code)) return code;
  }
}

async function checkRow(tx: Tx, v: MachineFormValues) {
  const [d] = await tx.select({ code: departments.code }).from(departments).where(eq(departments.code, v.deptCode));
  if (!d) throw new UserFacingError("Please choose the department.");
  const ids = [...new Set(v.serviceIds)];
  if (ids.length) {
    const found = await tx.select({ id: services.id }).from(services).where(sql`${services.id} = any(${sql.param(ids)}::int[])`);
    if (found.length !== ids.length) throw new UserFacingError("One of the services could not be found. Please refresh the page.");
  }
  return {
    row: {
      name: v.name.trim(),
      deptCode: v.deptCode,
      makeModel: clean(v.makeModel),
      keySpecs: clean(v.keySpecs),
      testStandards: clean(v.testStandards),
      nablAccredited: v.nablAccredited,
      parallelJobs: v.parallelJobs,
      runsNonstop: v.runsNonstop,
      location: clean(v.location),
      status: v.status,
      isActive: v.status !== "INACTIVE",
      notes: clean(v.notes),
    },
    ids,
  };
}

export async function createMachine(db: DB | Tx, v: MachineFormValues) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(4242201)`);
    const { row, ids } = await checkRow(tx, v);
    const [same] = await tx.select({ id: machines.id }).from(machines).where(sql`lower(${machines.name}) = lower(${row.name})`);
    if (same) throw new UserFacingError(`There is already a machine called “${row.name}”.`);
    let code = clean(v.code)?.toUpperCase() ?? null;
    if (code) {
      const [taken] = await tx.select({ id: machines.id }).from(machines).where(sql`upper(${machines.code}) = ${code}`);
      if (taken) throw new UserFacingError(`Machine code ${code} is already used. Please choose another, or leave it empty for the next number.`);
    } else code = await nextMachineCode(tx);
    const [{ n }] = (await tx.execute<{ n: number }>(sql`select coalesce(max(sort_order), 0) + 1 as n from machines where dept_code = ${row.deptCode}`)).rows;
    const [m] = await tx
      .insert(machines)
      .values({ ...row, code, sortOrder: Number(n) })
      .returning();
    if (ids.length) await tx.insert(machineServices).values(ids.map((serviceId) => ({ machineId: m.id, serviceId })));
    return m;
  });
}

export async function updateMachine(db: DB | Tx, id: string, v: MachineFormValues) {
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(machines).where(eq(machines.id, id)).for("update");
    if (!before) throw new UserFacingError("This machine could not be found.");
    const { row, ids } = await checkRow(tx, v);
    const [same] = await tx.select({ id: machines.id }).from(machines).where(and(sql`lower(${machines.name}) = lower(${row.name})`, ne(machines.id, id)));
    if (same) throw new UserFacingError(`There is already a machine called “${row.name}”.`);
    const code = clean(v.code)?.toUpperCase() ?? before.code;
    if (code !== before.code) {
      const [taken] = await tx.select({ id: machines.id }).from(machines).where(and(sql`upper(${machines.code}) = ${code}`, ne(machines.id, id)));
      if (taken) throw new UserFacingError(`Machine code ${code} is already used. Please choose another.`);
    }
    await tx.update(machines).set({ ...row, code }).where(eq(machines.id, id));
    await tx.delete(machineServices).where(eq(machineServices.machineId, id));
    if (ids.length) await tx.insert(machineServices).values(ids.map((serviceId) => ({ machineId: id, serviceId })));
  });
}

/** Bookings (not cancelled) on a machine that overlap a time span, with their job numbers. */
export async function clashingBookings(db: DB | Tx, machineId: string, start: Date, end: Date) {
  return db
    .select({ id: jobBookings.id, jobId: jobBookings.jobId, startAt: jobBookings.startAt, endAt: jobBookings.endAt, hours: jobBookings.hours, ticketNo: tickets.ticketNo, company: sql<string>`${tickets.snapshot}->>'companyName'` })
    .from(jobBookings)
    .innerJoin(jobs, eq(jobs.id, jobBookings.jobId))
    .innerJoin(tickets, eq(tickets.id, jobs.ticketId))
    .where(and(eq(jobBookings.machineId, machineId), isNull(jobBookings.cancelledAt), lt(jobBookings.startAt, end), gt(jobBookings.endAt, start)))
    .orderBy(asc(jobBookings.startAt));
}

export interface BlockInput {
  machineId: string;
  type: BlockTypeName;
  start: Date;
  end: Date;
  note?: string | null;
  createdBy?: string | null;
  invDocumentId?: string | null;
}

/**
 * Blocks a machine (it shows as grey stripes and nothing can be booked over it). Existing
 * bookings that clash are returned, so they can be moved; they are never moved silently.
 */
export async function blockMachine(db: DB | Tx, input: BlockInput) {
  if (!(input.type in BLOCK_TYPES)) throw new UserFacingError("Please choose why the machine is not available.");
  if (!(input.end > input.start)) throw new UserFacingError("The end should be after the start.");
  if (input.end.getTime() - input.start.getTime() > 366 * 86_400_000) throw new UserFacingError("Please block at most one year at a time.");
  return db.transaction(async (tx) => {
    const [m] = await tx.select().from(machines).where(eq(machines.id, input.machineId)).for("update");
    if (!m) throw new UserFacingError("That machine could not be found.");
    const [b] = await tx
      .insert(machineBlocks)
      .values({ machineId: m.id, type: input.type, startAt: input.start, endAt: input.end, note: clean(input.note), createdBy: clean(input.createdBy) ?? (await actorName()), invDocumentId: input.invDocumentId ?? null })
      .returning();
    return { block: b, machine: m, clashes: await clashingBookings(tx, m.id, input.start, input.end) };
  });
}

/** "Mark breakdown": blocks the machine from now until the time given, and sets it to Breakdown. */
export async function markBreakdown(db: DB | Tx, machineId: string, until: Date, note: string | null, opts: { now?: Date; createdBy?: string | null } = {}) {
  const now = new Date(Math.floor((opts.now ?? new Date()).getTime() / 60_000) * 60_000); // from this minute
  if (!(until > now)) throw new UserFacingError("Please choose when the machine should be working again (later than now).");
  return db.transaction(async (tx) => {
    const r = await blockMachine(tx, { machineId, type: "BREAKDOWN", start: now, end: until, note: note || "Breakdown", createdBy: opts.createdBy });
    await tx.update(machines).set({ status: "BREAKDOWN" }).where(eq(machines.id, machineId));
    return r;
  });
}

/**
 * "Extend": the machine is still broken down. Its latest breakdown block now lasts until the new
 * time (continuing from where it ended), and bookings that clash are listed again.
 */
export async function extendBreakdown(db: DB | Tx, machineId: string, until: Date, opts: { now?: Date } = {}) {
  const now = opts.now ?? new Date();
  if (!(until > now)) throw new UserFacingError("Please choose when the machine should be working again (later than now).");
  return db.transaction(async (tx) => {
    const [m] = await tx.select().from(machines).where(eq(machines.id, machineId)).for("update");
    if (!m) throw new UserFacingError("That machine could not be found.");
    if (m.status !== "BREAKDOWN") throw new UserFacingError(`${m.name} isn't marked as broken down.`);
    const [b] = await tx
      .select()
      .from(machineBlocks)
      .where(and(eq(machineBlocks.machineId, machineId), eq(machineBlocks.type, "BREAKDOWN")))
      .orderBy(sql`${machineBlocks.endAt} desc`)
      .limit(1);
    if (!b) throw new UserFacingError(`${m.name} has no breakdown to extend. Use “Mark breakdown”.`);
    const oldEnd = b.endAt;
    await tx.update(machineBlocks).set({ endAt: until }).where(eq(machineBlocks.id, b.id));
    return { machine: m, from: oldEnd, clashes: await clashingBookings(tx, machineId, oldEnd < now ? now : oldEnd, until) };
  });
}

/** "Working again": back to Available; a breakdown block still running ends now. */
export async function markFixed(db: DB | Tx, machineId: string, opts: { now?: Date } = {}) {
  const now = opts.now ?? new Date();
  return db.transaction(async (tx) => {
    const [m] = await tx.select().from(machines).where(eq(machines.id, machineId)).for("update");
    if (!m) throw new UserFacingError("That machine could not be found.");
    await tx
      .update(machineBlocks)
      .set({ endAt: now })
      .where(and(eq(machineBlocks.machineId, machineId), eq(machineBlocks.type, "BREAKDOWN"), lt(machineBlocks.startAt, now), gt(machineBlocks.endAt, now)));
    await tx.update(machines).set({ status: "AVAILABLE", isActive: true }).where(eq(machines.id, machineId));
    return m;
  });
}

/** Removes blocked time that hasn't ended (e.g. planned maintenance that was called off). */
export async function deleteBlock(db: DB | Tx, blockId: string, opts: { now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const [b] = await db.select().from(machineBlocks).where(eq(machineBlocks.id, blockId));
  if (!b) throw new UserFacingError("That blocked time could not be found.");
  if (b.endAt <= now) throw new UserFacingError("Blocked time in the past is kept for the records.");
  if (b.startAt < now) {
    await db.update(machineBlocks).set({ endAt: now }).where(eq(machineBlocks.id, blockId));
    return { ended: true, message: `${BLOCK_TYPES[b.type]} ended now (it had started ${formatWhen(b.startAt)}).` };
  }
  await db.delete(machineBlocks).where(eq(machineBlocks.id, blockId));
  return { ended: false, message: `${BLOCK_TYPES[b.type]} removed.` };
}

// ---- holidays ----------------------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function addHoliday(db: DB | Tx, date: string, name: string) {
  if (!DATE_RE.test(date)) throw new UserFacingError("Please choose the date.");
  const n = name.trim();
  if (!n) throw new UserFacingError("Please enter the holiday name, e.g. Diwali.");
  if (n.length > 80) throw new UserFacingError("Keep the name under 80 characters.");
  const [same] = await db.select().from(holidays).where(eq(holidays.date, date));
  if (same) throw new UserFacingError(`${same.name} is already on that date.`);
  const [h] = await db.insert(holidays).values({ date, name: n }).returning();
  return h;
}

export async function deleteHoliday(db: DB | Tx, id: number) {
  await db.delete(holidays).where(eq(holidays.id, id));
}

/** Adds the good rows, skips dates already in the list. */
export async function importHolidays(db: DB | Tx, rows: { date: string; name: string }[]) {
  return db.transaction(async (tx) => {
    const have = new Set((await tx.select({ date: holidays.date }).from(holidays)).map((h) => h.date));
    let added = 0;
    let skipped = 0;
    for (const r of rows) {
      if (have.has(r.date)) {
        skipped++;
        continue;
      }
      await tx.insert(holidays).values({ date: r.date, name: r.name.trim().slice(0, 80) });
      have.add(r.date);
      added++;
    }
    return { added, skipped };
  });
}
