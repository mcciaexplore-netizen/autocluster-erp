"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { UserFacingError } from "@/db/quote-writer";
import { finishJob, handOverJob, holdJob, logReadyMessage, OtherJobRunningError, pauseJob, startJob } from "@/db/work-writer";
import { isSignedIn } from "@/lib/auth-guard";
import { SIGNED_OUT_MESSAGE } from "@/lib/auth-messages";

type Result<T> = { ok: true; data: T } | { ok: false; message: string; otherRunning?: string };

async function run<T>(fn: () => Promise<T>): Promise<Result<T>> {
  if (!(await isSignedIn())) return { ok: false, message: SIGNED_OUT_MESSAGE };
  try {
    const data = await fn();
    revalidatePath("/", "layout");
    return { ok: true, data };
  } catch (e) {
    if (e instanceof OtherJobRunningError) return { ok: false, message: e.message, otherRunning: e.otherTicketNo };
    if (e instanceof UserFacingError) return { ok: false, message: e.message };
    if (e instanceof z.ZodError) return { ok: false, message: e.issues[0]?.message ?? "Some details need a second look." };
    console.error("work", e);
    return { ok: false, message: "We couldn't save that right now. Please try again." };
  }
}

const id = z.string().uuid();
const opt = id.nullable();

export async function startJobAction(jobId: string, operatorId: string | null, pauseOther = false) {
  return run(() => startJob(db, id.parse(jobId), { operatorId: opt.parse(operatorId), pauseOther }));
}
export async function pauseJobAction(jobId: string, reason: string, note: string | null, operatorId: string | null) {
  return run(() => pauseJob(db, id.parse(jobId), z.string().max(60).parse(reason), z.string().max(500).nullable().parse(note), { operatorId: opt.parse(operatorId) }));
}
export async function holdJobAction(jobId: string, reason: string, note: string | null) {
  return run(() => holdJob(db, id.parse(jobId), z.string().max(60).parse(reason), z.string().max(500).nullable().parse(note)));
}
export async function finishJobAction(jobId: string, input: { note: string; qtyDone?: string | null; problems?: string | null }, operatorId: string | null) {
  return run(() =>
    finishJob(db, id.parse(jobId), {
      note: z.string().max(2000).parse(input.note),
      qtyDone: z.string().max(200).nullish().parse(input.qtyDone),
      problems: z.string().max(2000).nullish().parse(input.problems),
      operatorId: opt.parse(operatorId),
    }),
  );
}
export async function handOverAction(jobId: string, date: string, receivedBy: string) {
  return run(() => handOverJob(db, id.parse(jobId), z.string().max(10).parse(date), z.string().max(200).parse(receivedBy)));
}
export async function readySentAction(jobId: string, phone: string | null) {
  return run(() => logReadyMessage(db, id.parse(jobId), z.string().max(30).nullable().parse(phone)));
}
