"use server";

import { can } from "@/lib/auth/can";
import { signedInUser } from "@/lib/auth/guard";
import { assertInScope, jobDept } from "@/lib/auth/scope";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { UserFacingError } from "@/db/quote-writer";
import { finishJob, handOverJob, holdJob, logReadyMessage, NeedMachineError, OtherJobRunningError, pauseJob, startJob } from "@/db/work-writer";
import { allow } from "@/lib/auth/guard";
import { doneByFor, logOnBehalf } from "@/lib/auth/done-by";
import type { Permission } from "@/lib/auth/permissions";

export type NeedMachine = { suggestedMachineId: string | null; machines: { id: string; name: string; deptCode: string; suitable: boolean }[]; hours: number; later: { bookingId: string; machine: string; start: string } | null };
type Result<T> = { ok: true; data: T } | { ok: false; message: string; otherRunning?: string; needMachine?: NeedMachine };

async function run<T>(perm: Permission | Permission[], fn: () => Promise<T>): Promise<Result<T>> {
  const g = await allow(perm);
  if (!g.ok) return { ok: false, message: g.message };
  try {
    const data = await fn();
    revalidatePath("/", "layout");
    return { ok: true, data };
  } catch (e) {
    if (e instanceof OtherJobRunningError) return { ok: false, message: e.message, otherRunning: e.otherTicketNo };
    if (e instanceof NeedMachineError) return { ok: false, message: e.message, needMachine: { ...e.info, later: e.info.later ? { ...e.info.later, start: e.info.later.start.toISOString() } : null } };
    if (e instanceof UserFacingError) return { ok: false, message: e.message };
    if (e instanceof z.ZodError) return { ok: false, message: e.issues[0]?.message ?? "Some details need a second look." };
    console.error("work", e);
    return { ok: false, message: "We couldn't save that right now. Please try again." };
  }
}

const id = z.string().uuid();
const opt = id.nullable();

export async function startJobAction(jobId: string, operatorId: string | null, more: { pauseOther?: boolean; machineId?: string | null; removeLaterBookingId?: string | null } = {}) {
  return run("planning.operate", async () => {
    await assertInScope("planning.operate", [await jobDept(id.parse(jobId))]);
    const who = await doneByFor(opt.parse(operatorId));
    const r = await startJob(db, id.parse(jobId), {
      operatorId: who.id,
      pauseOther: !!more.pauseOther,
      machineId: more.machineId ? id.parse(more.machineId) : null,
      removeLaterBookingId: more.removeLaterBookingId ? id.parse(more.removeLaterBookingId) : null,
    });
    await logOnBehalf(who, "Planning", "started a job", { type: "job", id: jobId });
    return r;
  });
}
export async function pauseJobAction(jobId: string, reason: string, note: string | null, operatorId: string | null) {
  return run("planning.operate", async () => {
    await assertInScope("planning.operate", [await jobDept(id.parse(jobId))]);
    const who = await doneByFor(opt.parse(operatorId));
    const r = await pauseJob(db, id.parse(jobId), z.string().max(60).parse(reason), z.string().max(500).nullable().parse(note), { operatorId: who.id });
    await logOnBehalf(who, "Planning", `paused a job (${reason})`, { type: "job", id: jobId });
    return r;
  });
}
export async function holdJobAction(jobId: string, reason: string, note: string | null) {
  return run(["planning.operate", "planning.book"], async () => {
    await assertInScope(can(await signedInUser(), "planning.book") ? "planning.book" : "planning.operate", [await jobDept(id.parse(jobId))]);
    return holdJob(db, id.parse(jobId), z.string().max(60).parse(reason), z.string().max(500).nullable().parse(note));
  });
}
export async function finishJobAction(jobId: string, input: { note: string; qtyDone?: string | null; problems?: string | null }, operatorId: string | null) {
  return run("planning.operate", async () => {
    await assertInScope("planning.operate", [await jobDept(id.parse(jobId))]);
    const who = await doneByFor(opt.parse(operatorId));
    const r = await finishJob(db, id.parse(jobId), {
      note: z.string().max(2000).parse(input.note),
      qtyDone: z.string().max(200).nullish().parse(input.qtyDone),
      problems: z.string().max(2000).nullish().parse(input.problems),
      operatorId: who.id,
    });
    await logOnBehalf(who, "Planning", "finished a job", { type: "job", id: jobId });
    return r;
  });
}
export async function handOverAction(jobId: string, date: string, receivedBy: string) {
  return run("planning.operate", async () => {
    await assertInScope("planning.operate", [await jobDept(id.parse(jobId))]);
    return handOverJob(db, id.parse(jobId), z.string().max(10).parse(date), z.string().max(200).parse(receivedBy));
  });
}
export async function readySentAction(jobId: string, phone: string | null) {
  return run("planning.operate", async () => {
    await assertInScope("planning.operate", [await jobDept(id.parse(jobId))]);
    return logReadyMessage(db, id.parse(jobId), z.string().max(30).nullable().parse(phone));
  });
}
