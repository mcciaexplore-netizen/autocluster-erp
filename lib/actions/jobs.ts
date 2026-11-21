"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { bookTime, cancelBooking, extendHold, findFreeSlots, moveBooking, moveToNextFreeSlot, PastBookingError } from "@/db/booking-writer";
import { addJobEvent, bulkMarkDone, bulkUpdateJobs, updateJobDetails } from "@/db/job-writer";
import { UserFacingError } from "@/db/quote-writer";
import { files, jobFiles, jobs, machineServices, services } from "@/db/schema";
import { suggestHours } from "@/lib/planning/time-needed";
import { isSignedIn } from "@/lib/auth-guard";
import { SIGNED_OUT_MESSAGE } from "@/lib/auth-messages";
import { istAt } from "@/lib/planning/hours";
import { LOCAL_DT_RE } from "@/lib/validation/planning";

type Result<T> = { ok: true; data: T } | { ok: false; message: string; past?: boolean };

async function run<T>(fn: () => Promise<T>): Promise<Result<T>> {
  if (!(await isSignedIn())) return { ok: false, message: SIGNED_OUT_MESSAGE };
  try {
    const data = await fn();
    revalidatePath("/", "layout");
    return { ok: true, data };
  } catch (e) {
    if (e instanceof PastBookingError) return { ok: false, message: e.message, past: true };
    if (e instanceof UserFacingError) return { ok: false, message: e.message };
    if (e instanceof z.ZodError) return { ok: false, message: e.issues[0]?.message ?? "Some details need a second look." };
    console.error("jobs", e);
    return { ok: false, message: "We couldn't save that right now. Please try again." };
  }
}

const id = z.string().uuid();
const localDt = z.string().regex(LOCAL_DT_RE, { message: "Please enter the date and time." }).transform((v) => istAt(v.slice(0, 10), Number(v.slice(11, 13)) * 60 + Number(v.slice(14, 16))));
const hours = z.number({ message: "Enter the hours, e.g. 4." }).positive({ message: "Enter the hours, e.g. 4." }).max(2000);

const detailsSchema = z.object({
  hoursNeeded: z.number().positive().max(5000).nullable(),
  promisedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  priority: z.enum(["NORMAL", "URGENT"]),
  operatorId: id.nullable(),
  instructions: z.string().max(4000).nullable(),
});

export async function saveJobDetailsAction(jobId: string, input: z.input<typeof detailsSchema>) {
  return run(() => updateJobDetails(db, id.parse(jobId), detailsSchema.parse(input)));
}

export async function bulkJobsAction(jobIds: string[], change: { operatorId?: string | null; priority?: "NORMAL" | "URGENT" }) {
  return run(async () => {
    const ids = z.array(id).min(1).max(500).parse(jobIds);
    const c = z.object({ operatorId: id.nullable().optional(), priority: z.enum(["NORMAL", "URGENT"]).optional() }).parse(change);
    return { updated: await bulkUpdateJobs(db, ids, c) };
  });
}

export async function bulkMarkDoneAction(jobIds: string[], note: string) {
  return run(async () => ({ done: await bulkMarkDone(db, z.array(id).min(1).max(500).parse(jobIds), z.string().max(2000).parse(note)) }));
}

const bookSchema = z.object({
  jobId: id,
  machineId: z.string().min(1, { message: "Please choose the machine." }).pipe(id),
  start: localDt,
  hours,
  operatorId: id.nullish(),
  note: z.string().max(500).nullish(),
  allowPast: z.boolean().optional(),
});

export async function bookTimeAction(input: z.input<typeof bookSchema>) {
  return run(async () => {
    const r = await bookTime(db, bookSchema.parse(input));
    return { machine: r.machine, ticketNo: r.ticketNo, tentative: r.booking.isTentative, holdUntil: r.booking.holdUntil, start: r.booking.startAt.toISOString(), end: r.booking.endAt.toISOString(), warning: r.warning };
  });
}

/** Instant booking from a "Find next free slot" option (the start is the exact slot time). */
export async function bookSlotAction(input: { jobId: string; machineId: string; start: string; hours: number; operatorId?: string | null; note?: string | null }) {
  return run(async () => {
    const r = await bookTime(db, {
      jobId: id.parse(input.jobId),
      machineId: id.parse(input.machineId),
      start: new Date(z.string().datetime().parse(input.start)),
      hours: hours.parse(input.hours),
      operatorId: input.operatorId ? id.parse(input.operatorId) : null,
      note: input.note ?? null,
    });
    return { machine: r.machine, ticketNo: r.ticketNo, tentative: r.booking.isTentative, holdUntil: r.booking.holdUntil, start: r.booking.startAt.toISOString(), end: r.booking.endAt.toISOString(), warning: r.warning };
  });
}

export async function findSlotsAction(machineIds: string[], h: number, ignoreBookingId?: string | null) {
  return run(async () => {
    const slots = await findFreeSlots(db, z.array(id).max(200).parse(machineIds), hours.parse(h), { ignoreBookingId: ignoreBookingId ? id.parse(ignoreBookingId) : undefined });
    return slots.map((s) => ({ machineId: s.machineId, machine: s.machine, start: s.start.toISOString(), end: s.end.toISOString() }));
  });
}

const moveSchema = z.object({ machineId: id.optional(), start: localDt.optional(), startExact: z.string().datetime().optional(), hours: hours.optional(), allowPast: z.boolean().optional() });

export async function moveBookingAction(bookingId: string, change: z.input<typeof moveSchema>) {
  return run(async () => {
    const c = moveSchema.parse(change);
    const r = await moveBooking(db, id.parse(bookingId), { machineId: c.machineId, start: c.startExact ? new Date(c.startExact) : c.start, hours: c.hours, allowPast: c.allowPast });
    return { machine: r.machine, start: r.start.toISOString(), end: r.end.toISOString(), warning: r.warning };
  });
}

export async function cancelBookingAction(bookingId: string, release = false) {
  return run(() => cancelBooking(db, id.parse(bookingId), release ? "Tentative hold released" : "Booking removed"));
}

export async function extendHoldAction(bookingId: string, until: string) {
  return run(() => extendHold(db, id.parse(bookingId), z.string().max(10).parse(until)));
}

export async function moveToNextFreeSlotAction(bookingId: string) {
  return run(async () => {
    const r = await moveToNextFreeSlot(db, id.parse(bookingId));
    return { machine: r.machine, start: r.start.toISOString(), end: r.end.toISOString() };
  });
}

/** Attachments (drawings, test plan): files uploaded to Blob, then linked to the job. */
export async function addJobFileAction(jobId: string, fileId: string) {
  return run(async () => {
    const j = id.parse(jobId);
    const [f] = await db.select().from(files).where(eq(files.id, id.parse(fileId)));
    if (!f || f.kind !== "JOB") throw new UserFacingError("The file could not be found. Please upload it again.");
    const [job] = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.id, j));
    if (!job) throw new UserFacingError("This job could not be found.");
    await db.insert(jobFiles).values({ jobId: j, fileId: f.id }).onConflictDoNothing();
    await addJobEvent(db, j, "FILE", `File added: ${f.fileName}`);
    return { fileName: f.fileName };
  });
}

export async function removeJobFileAction(jobId: string, fileId: string) {
  return run(async () => {
    const [f] = await db.select({ name: files.fileName }).from(files).where(eq(files.id, id.parse(fileId)));
    await db.delete(jobFiles).where(and(eq(jobFiles.jobId, id.parse(jobId)), eq(jobFiles.fileId, fileId)));
    await addJobEvent(db, jobId, "FILE", `File removed: ${f?.name ?? "file"}`);
    return { ok: true };
  });
}

/** The job panel's data: the job, booking options, and the ticket's materials. */
export async function loadJobPanelAction(jobId: string) {
  if (!(await isSignedIn())) return { ok: false as const, message: SIGNED_OUT_MESSAGE };
  const { getJobDetail, getBookingOptions } = await import("@/lib/planning-data");
  const { getTicketDetail } = await import("@/lib/orders-data");
  const detail = await getJobDetail(z.string().uuid().parse(jobId));
  if (!detail) return { ok: false as const, message: "This job could not be found." };
  const [options, ticket] = await Promise.all([getBookingOptions(), getTicketDetail(detail.ticket.id)]);
  return { ok: true as const, data: { detail, options, materials: ticket?.materials ?? null } };
}
export type JobPanelData = Extract<Awaited<ReturnType<typeof loadJobPanelAction>>, { ok: true }>["data"];

/** Dropping a job onto the timeline: its details for the Book time form. */
export async function loadBookJobAction(jobId: string) {
  if (!(await isSignedIn())) return { ok: false as const, message: SIGNED_OUT_MESSAGE };
  const { getBookJob } = await import("@/lib/planning-data");
  const j = await getBookJob(z.string().uuid().parse(jobId));
  return j ? { ok: true as const, data: j } : { ok: false as const, message: "This job could not be found." };
}

/**
 * Quotation builder hint: the earliest free slot for a service (on its machines), for the hours
 * the quantity suggests (1 h when there's nothing to go on). Never blocks anything.
 */
export async function earliestSlotForServiceAction(serviceId: number, billableQty: number) {
  if (!(await isSignedIn())) return null;
  try {
    const sid = z.number().int().positive().parse(serviceId);
    const qty = z.number().min(0).max(1_000_000).parse(billableQty);
    const [svc] = await db.select().from(services).where(eq(services.id, sid));
    if (!svc) return null;
    const ms = await db.select({ id: machineServices.machineId }).from(machineServices).where(eq(machineServices.serviceId, sid));
    if (!ms.length) return { none: true as const };
    const suggested = suggestHours({ unitType: svc.unitType, billableQty: qty, setupMinutes: svc.setupMinutes, minutesPerUnit: svc.minutesPerUnit });
    const [slot] = await findFreeSlots(db, ms.map((m) => m.id), Math.min(suggested ?? 1, 2000), { limit: 1 });
    return slot ? { none: false as const, start: slot.start.toISOString(), machine: slot.machine, assumed: suggested == null } : null;
  } catch {
    return null;
  }
}
