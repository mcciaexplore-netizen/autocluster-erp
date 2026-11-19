"use server";

import { isSignedIn } from "@/lib/auth-guard";
import { SIGNED_OUT_MESSAGE } from "@/lib/auth-messages";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { settingsSchema, type SettingsInput } from "@/lib/validation/settings";

export async function saveSettings(input: SettingsInput) {
  if (!(await isSignedIn())) return { ok: false as const, message: SIGNED_OUT_MESSAGE };
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, message: parsed.error.issues[0]?.message ?? "Some settings need a second look." };
  const v = parsed.data;
  await db
    .update(settings)
    .set({
      ...v,
      quotePrefix: v.quotePrefix.toUpperCase(),
      memberDiscountPct: String(v.memberDiscountPct),
      gstPct: String(v.gstPct),
    })
    .where(eq(settings.id, 1));
  revalidatePath("/", "layout");
  return { ok: true as const };
}
