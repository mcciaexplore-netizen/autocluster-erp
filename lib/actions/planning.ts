"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { addHoliday, blockMachine, createMachine, deleteBlock, deleteHoliday, extendBreakdown, importHolidays, markBreakdown, markFixed, updateMachine } from "@/db/machine-writer";
import { UserFacingError } from "@/db/quote-writer";
import { services } from "@/db/schema";
import { isSignedIn } from "@/lib/auth-guard";
import { SIGNED_OUT_MESSAGE } from "@/lib/auth-messages";
import { readHolidaysFile } from "@/lib/planning/holiday-excel";
import { istAt } from "@/lib/planning/hours";
import { LOCAL_DT_RE, machineFormSchema, type MachineFormValues } from "@/lib/validation/planning";
import { eq } from "drizzle-orm";

type Result<T> = { ok: true; data: T } | { ok: false; message: string };

async function run<T>(fn: () => Promise<T>): Promise<Result<T>> {
  if (!(await isSignedIn())) return { ok: false, message: SIGNED_OUT_MESSAGE };
  try {
    const data = await fn();
    revalidatePath("/", "layout");
    return { ok: true, data };
  } catch (e) {
    if (e instanceof UserFacingError) return { ok: false, message: e.message };
    if (e instanceof z.ZodError) return { ok: false, message: e.issues[0]?.message ?? "Some details need a second look." };
    console.error("planning", e);
    return { ok: false, message: "We couldn't save that right now. Please try again." };
  }
}

const id = z.string().uuid();
/** "2026-11-30T09:30" in a date-time box = India time. */
const localDt = z.string().regex(LOCAL_DT_RE, { message: "Please enter the date and time." }).transform((v) => istAt(v.slice(0, 10), Number(v.slice(11, 13)) * 60 + Number(v.slice(14, 16))));

export async function saveMachineAction(machineId: string | null, input: MachineFormValues) {
  return run(async () => {
    const v = machineFormSchema.parse(input);
    if (machineId) {
      await updateMachine(db, id.parse(machineId), v);
      return { id: machineId };
    }
    const m = await createMachine(db, v);
    return { id: m.id, code: m.code };
  });
}

const blockSchema = z.object({
  machineId: id,
  type: z.enum(["MAINTENANCE", "CALIBRATION", "BREAKDOWN", "INTERNAL", "OTHER"]),
  from: localDt,
  to: localDt,
  note: z.string().max(500).nullish(),
  invDocumentId: z.string().uuid().nullish(),
});

export async function blockTimeAction(input: z.input<typeof blockSchema>) {
  return run(async () => {
    const v = blockSchema.parse(input);
    const r = await blockMachine(db, { machineId: v.machineId, type: v.type, start: v.from, end: v.to, note: v.note, invDocumentId: v.invDocumentId ?? null });
    return { machine: r.machine.name, clashes: r.clashes.map((c) => ({ id: c.id, ticketNo: c.ticketNo, company: c.company, startAt: c.startAt.toISOString(), endAt: c.endAt.toISOString() })) };
  });
}

export async function markBreakdownAction(machineId: string, until: string, note: string | null) {
  return run(async () => {
    const r = await markBreakdown(db, id.parse(machineId), localDt.parse(until), z.string().max(500).nullable().parse(note));
    return { machine: r.machine.name, clashes: r.clashes.map((c) => ({ id: c.id, ticketNo: c.ticketNo, company: c.company, startAt: c.startAt.toISOString(), endAt: c.endAt.toISOString() })) };
  });
}

export async function extendBreakdownAction(machineId: string, until: string) {
  return run(async () => {
    const r = await extendBreakdown(db, id.parse(machineId), localDt.parse(until));
    return { machine: r.machine.name, clashes: r.clashes.map((c) => ({ id: c.id, ticketNo: c.ticketNo, company: c.company, startAt: c.startAt.toISOString(), endAt: c.endAt.toISOString() })) };
  });
}

export async function markFixedAction(machineId: string) {
  return run(async () => ({ machine: (await markFixed(db, id.parse(machineId))).name }));
}

export async function deleteBlockAction(blockId: string) {
  return run(() => deleteBlock(db, id.parse(blockId)));
}

export async function addHolidayAction(date: string, name: string) {
  return run(async () => {
    const h = await addHoliday(db, z.string().max(10).parse(date), z.string().max(200).parse(name));
    return { id: h.id };
  });
}

export async function deleteHolidayAction(holidayId: number) {
  return run(() => deleteHoliday(db, z.number().int().positive().parse(holidayId)));
}

export async function importHolidaysAction(form: FormData) {
  return run(async () => {
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) throw new UserFacingError("Please choose the Excel file first.");
    if (!/\.xlsx$/i.test(file.name)) throw new UserFacingError("Please upload an Excel file (.xlsx).");
    const { rows, problems } = await readHolidaysFile(new Uint8Array(await file.arrayBuffer()));
    const r = rows.length ? await importHolidays(db, rows) : { added: 0, skipped: 0 };
    return { ...r, problems };
  });
}

/** Rate Card: the time settings that suggest a job's time needed. */
export async function saveServiceTimeAction(serviceId: number, setupMinutes: number | null, minutesPerUnit: number | null) {
  return run(async () => {
    const sid = z.number().int().positive().parse(serviceId);
    const setup = z.number().int().min(0).max(10_000).nullable().parse(setupMinutes);
    const per = z.number().min(0).max(100_000).nullable().parse(minutesPerUnit);
    const [row] = await db
      .update(services)
      .set({ setupMinutes: setup, minutesPerUnit: per == null ? null : String(per) })
      .where(eq(services.id, sid))
      .returning({ id: services.id });
    if (!row) throw new UserFacingError("This service could not be found.");
    return { id: row.id };
  });
}
