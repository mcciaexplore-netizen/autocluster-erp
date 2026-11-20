"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { discardCount, saveCountLine, startCount } from "@/db/count-writer";
import { UserFacingError } from "@/db/quote-writer";
import { completeCount } from "@/db/stock-writer";
import { isSignedIn } from "@/lib/auth-guard";
import { SIGNED_OUT_MESSAGE } from "@/lib/auth-messages";

type Result<T> = { ok: true; data: T } | { ok: false; message: string };

const id = z.string().uuid();
const optId = z.string().uuid().nullish().or(z.literal("").transform(() => null));

async function run<T>(fn: () => Promise<T>, refresh = true): Promise<Result<T>> {
  if (!(await isSignedIn())) return { ok: false, message: SIGNED_OUT_MESSAGE };
  try {
    const data = await fn();
    if (refresh) revalidatePath("/", "layout");
    return { ok: true, data };
  } catch (e) {
    if (e instanceof UserFacingError) return { ok: false, message: e.message };
    if (e instanceof z.ZodError) return { ok: false, message: "Some details didn't come through. Please try again." };
    console.error("count", e);
    return { ok: false, message: "We couldn't save that right now. Please try again." };
  }
}

export async function startCountAction(input: { categoryId?: string | null; deptCode?: string | null; doneBy?: string | null }) {
  const p = z.object({ categoryId: optId, deptCode: z.string().max(20).nullish(), doneBy: optId }).parse(input);
  return run(() => startCount(db, p));
}

/** Saves one counted quantity as the person types (no page refresh, so the screen stays quick). */
export async function saveCountLineAction(lineId: number, counted: string | null) {
  return run(() => saveCountLine(db, z.number().int().positive().parse(lineId), z.string().max(20).nullable().parse(counted)), false);
}

export async function completeCountAction(countId: string, doneBy: string | null) {
  return run(() => completeCount(db, id.parse(countId), { doneBy: doneBy ? id.parse(doneBy) : null }));
}

export async function discardCountAction(countId: string) {
  return run(() => discardCount(db, id.parse(countId)));
}
