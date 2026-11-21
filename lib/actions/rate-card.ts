"use server";

import { isSignedIn } from "@/lib/auth-guard";
import { SIGNED_OUT_MESSAGE } from "@/lib/auth-messages";

import { eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { invServiceMaterials, services } from "@/db/schema";
import { todayIso } from "@/lib/format";

const rate = z.number().finite().min(0).max(10_000_000);
const changesSchema = z.array(z.object({ id: z.number().int(), rateMsme: rate, rateOem: rate })).max(500);

/** Saves new rates. They apply to new quotations only; saved quotations keep their own rates. */
export async function updateRates(changes: { id: number; rateMsme: number; rateOem: number }[]) {
  if (!(await isSignedIn())) return { ok: false as const, message: SIGNED_OUT_MESSAGE };
  const parsed = changesSchema.safeParse(changes);
  if (!parsed.success) return { ok: false as const, message: "Please check the rates. They must be numbers of 0 or more." };
  if (!parsed.data.length) return { ok: true as const, count: 0 };
  const today = todayIso();
  await db.transaction(async (tx) => {
    const current = await tx.select().from(services).where(inArray(services.id, parsed.data.map((c) => c.id)));
    for (const c of parsed.data) {
      const row = current.find((r) => r.id === c.id);
      if (!row) continue;
      const msme = c.rateMsme.toFixed(2);
      const oem = c.rateOem.toFixed(2);
      if (row.rateMsme === msme && row.rateOem === oem) continue;
      await tx.update(services).set({ rateMsme: msme, rateOem: oem, effectiveFrom: today }).where(eq(services.id, c.id));
    }
  });
  revalidatePath("/", "layout");
  return { ok: true as const, count: parsed.data.length };
}

/** "No materials needed" on a service. Only allowed when it has no materials list. */
export async function setNoMaterialsNeeded(id: number, on: boolean) {
  if (!(await isSignedIn())) return { ok: false as const, message: SIGNED_OUT_MESSAGE };
  if (on) {
    const [m] = await db.select({ n: sql<number>`count(*)::int` }).from(invServiceMaterials).where(eq(invServiceMaterials.serviceId, id));
    if ((m?.n ?? 0) > 0) return { ok: false as const, message: "This service has a materials list. Remove it first, then switch on “No materials needed”." };
  }
  await db.update(services).set({ noMaterialsNeeded: on }).where(eq(services.id, id));
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function setServiceActive(id: number, isActive: boolean) {
  if (!(await isSignedIn())) return { ok: false as const, message: SIGNED_OUT_MESSAGE };
  await db.update(services).set({ isActive }).where(eq(services.id, id));
  revalidatePath("/", "layout");
  return { ok: true as const };
}
