"use server";

import { logActivity } from "@/lib/activity";
import { doneByFor, logOnBehalf } from "@/lib/auth/done-by";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { UserFacingError } from "@/db/quote-writer";
import { clearOrdered, markOrdered, SEND_METHODS } from "@/db/reorder-writer";
import { allow } from "@/lib/auth/guard";
import type { Permission } from "@/lib/auth/permissions";

type Result<T> = { ok: true; data: T } | { ok: false; message: string };

async function run<T>(perm: Permission | Permission[], fn: () => Promise<T>): Promise<Result<T>> {
  const g = await allow(perm);
  if (!g.ok) return { ok: false, message: g.message };
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
  return run("inventory.reorder", async () => {
    const v = sendSchema.parse(input);
    const who = await doneByFor(v.doneBy);
    const r = await markOrdered(db, { ...v, doneBy: who.id });
    await logActivity({ area: "Inventory", action: "ordered", summary: `Sent an order to a supplier (${v.lines.length} items, by ${v.method.toLowerCase()})`, entityType: "supplier", entityId: v.supplierId });
    await logOnBehalf(who, "Inventory", "sent an order to a supplier");
    return r;
  });
}

export async function clearOrderedAction(itemId: string) {
  return run("inventory.reorder", async () => {
    const r = await clearOrdered(db, z.string().uuid().parse(itemId));
    await logActivity({ area: "Inventory", action: "ordered", summary: "Cleared “Ordered on” for an item", entityType: "inv_item", entityId: itemId });
    return r;
  });
}
