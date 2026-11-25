"use server";

import { logActivity } from "@/lib/activity";
import { doneByFor, logOnBehalf } from "@/lib/auth/done-by";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { discardCount, saveCountLine, startCount } from "@/db/count-writer";
import { UserFacingError } from "@/db/quote-writer";
import { completeCount } from "@/db/stock-writer";
import { allow } from "@/lib/auth/guard";
import type { Permission } from "@/lib/auth/permissions";

type Result<T> = { ok: true; data: T } | { ok: false; message: string };

const id = z.string().uuid();
const optId = z.string().uuid().nullish().or(z.literal("").transform(() => null));

async function run<T>(perm: Permission | Permission[], fn: () => Promise<T>, refresh = true): Promise<Result<T>> {
  const g = await allow(perm);
  if (!g.ok) return { ok: false, message: g.message };
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
  // Permission first, then the details.
  return run("inventory.count", async () => {
    const p = z.object({ categoryId: optId, deptCode: z.string().max(20).nullish(), doneBy: optId }).parse(input ?? {});
    const who = await doneByFor(p.doneBy);
    const r = await startCount(db, { ...p, doneBy: who.id });
    await logActivity({ area: "Inventory", action: "count", summary: `Started stock count ${r.countNo}`, entityType: "inv_count", entityId: r.id });
    await logOnBehalf(who, "Inventory", "started a stock count");
    return r;
  });
}

/** Saves one counted quantity as the person types (no page refresh, so the screen stays quick). */
export async function saveCountLineAction(lineId: number, counted: string | null) {
  return run("inventory.count", () => saveCountLine(db, z.number().int().positive().parse(lineId), z.string().max(20).nullable().parse(counted)), false);
}

export async function completeCountAction(countId: string, doneBy: string | null) {
  return run("inventory.count", async () => {
    const who = await doneByFor(doneBy ? id.parse(doneBy) : null);
    const r = await completeCount(db, id.parse(countId), { doneBy: who.id });
    await logOnBehalf(who, "Inventory", "completed a stock count", { type: "inv_count", id: countId });
    return r;
  });
}

export async function discardCountAction(countId: string) {
  return run("inventory.count", async () => {
    const r = await discardCount(db, id.parse(countId));
    await logActivity({ area: "Inventory", action: "count", summary: "Discarded a stock count", entityType: "inv_count", entityId: countId });
    return r;
  });
}
