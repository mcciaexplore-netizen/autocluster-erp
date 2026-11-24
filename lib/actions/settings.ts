"use server";

import { logActivity } from "@/lib/activity";
import { allow } from "@/lib/auth/guard";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { crmStages, settings } from "@/db/schema";
import { settingsSchema, type SettingsInput } from "@/lib/validation/settings";

export async function saveSettings(input: SettingsInput) {
  const g = await allow("settings.edit");
  if (!g.ok) return { ok: false as const, message: g.message };
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, message: parsed.error.issues[0]?.message ?? "Some settings need a second look." };
  const v = parsed.data;
  if (v.quoteCreatedMoveToStageId) {
    const [stage] = await db.select({ type: crmStages.type }).from(crmStages).where(eq(crmStages.id, v.quoteCreatedMoveToStageId));
    if (!stage) return { ok: false as const, message: "That stage no longer exists. Please choose another one." };
    if (stage.type !== "OPEN") return { ok: false as const, message: "Please choose an open stage (not Won or Lost) for new quotations." };
  }
  await db
    .update(settings)
    .set({
      ...v,
      quotePrefix: v.quotePrefix.toUpperCase(),
      ticketPrefix: v.ticketPrefix.toUpperCase(),
      leadPrefix: v.leadPrefix.toUpperCase(),
      invInPrefix: v.invInPrefix.toUpperCase(),
      invOutPrefix: v.invOutPrefix.toUpperCase(),
      invAdjPrefix: v.invAdjPrefix.toUpperCase(),
      invItemPrefix: v.invItemPrefix.toUpperCase(),
      quoteCreatedMoveToStageId: v.quoteCreatedMoveToStageId || null,
      memberDiscountPct: String(v.memberDiscountPct),
      workingDays: [...new Set(v.workingDays)].sort(),
      breakStart: v.breakStart || null,
      breakEnd: v.breakEnd || null,
      gstPct: String(v.gstPct),
    })
    .where(eq(settings.id, 1));
  await logActivity({ area: "Settings", action: "changed", summary: "Changed the general settings", entityType: "settings", entityId: null });
  revalidatePath("/", "layout");
  return { ok: true as const };
}
