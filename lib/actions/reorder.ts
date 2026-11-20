"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { UserFacingError } from "@/db/quote-writer";
import { clearOrdered, markOrdered, SEND_METHODS } from "@/db/reorder-writer";
import { isSignedIn } from "@/lib/auth-guard";
import { SIGNED_OUT_MESSAGE } from "@/lib/auth-messages";

type Result<T> = { ok: true; data: T } | { ok: false; message: string };

async function run<T>(fn: () => Promise<T>): Promise<Result<T>> {
  if (!(await isSignedIn())) return { ok: false, message: SIGNED_OUT_MESSAGE };
  try {
    const data = await fn();
    revalidatePath("/", "layout");
    return { ok: true, data };
  } catch (e) {
    if (e instanceof UserFacingError) return { ok: false, message: e.message };
    if (e instanceof z.ZodError) return { ok: false, message: "Some details didn't come through. Please try again." };
    console.error("reorder", e);
    return { ok: false, message: "We couldn't save that right now. Please try again." };
  }
}

const sendSchema = z.object({
  supplierId: z.string().uuid({ message: "Please choose the supplier." }),
  method: z.enum(SEND_METHODS),
  doneBy: z.string().uuid().nullish(),
  lines: z.array(z.object({ itemId: z.string().uuid(), qty: z.string().max(20) })).min(1).max(200),
});

/** "Send to supplier": notes the send and marks the items "Ordered on" today. */
export async function markOrderedAction(input: z.input<typeof sendSchema>) {
  return run(() => markOrdered(db, sendSchema.parse(input)));
}

export async function clearOrderedAction(itemId: string) {
  return run(() => clearOrdered(db, z.string().uuid().parse(itemId)));
}
