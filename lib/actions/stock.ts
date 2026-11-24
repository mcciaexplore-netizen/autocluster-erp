"use server";

import { can } from "@/lib/auth/can";
import { signedInUser } from "@/lib/auth/guard";
import { assertInScope, assertItemsInScope, ticketDept } from "@/lib/auth/scope";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { UserFacingError } from "@/db/quote-writer";
import { adjustStock, receiveStock, reverseDocument, issueStock } from "@/db/stock-writer";
import { allow } from "@/lib/auth/guard";
import type { Permission } from "@/lib/auth/permissions";

type Result<T> = { ok: true; data: T } | { ok: false; message: string };

const id = z.string().uuid();
const optId = z.string().uuid().nullish().or(z.literal("").transform(() => null));
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().or(z.literal("").transform(() => null));
const text = (max: number) => z.string().max(max).nullish();
const qty = z.string().max(20);

async function run<T>(perm: Permission | Permission[], fn: () => Promise<T>): Promise<Result<T>> {
  const g = await allow(perm);
  if (!g.ok) return { ok: false, message: g.message };
  try {
    const data = await fn();
    revalidatePath("/", "layout");
    return { ok: true, data };
  } catch (e) {
    if (e instanceof UserFacingError) return { ok: false, message: e.message };
    if (e instanceof z.ZodError) return { ok: false, message: "Some details didn't come through. Please check the lines and try again." };
    console.error("stock", e);
    return { ok: false, message: "We couldn't save that right now. Please try again." };
  }
}

const receiveSchema = z.object({
  supplierId: z.string().min(1, { message: "Please choose the supplier." }).pipe(id),
  supplierBillNo: text(60),
  supplierBillDate: date,
  fileId: optId,
  doneBy: optId,
  note: text(1000),
  lines: z
    .array(
      z.object({
        itemId: id,
        qty,
        inPacks: z.boolean().optional(),
        rate: z.string().max(20),
        ratePerPack: z.boolean().optional(),
        batchNo: text(40),
        expiryDate: date,
      }),
    )
    .min(1)
    .max(100),
});
export type ReceiveFormInput = z.input<typeof receiveSchema>;

export async function receiveStockAction(input: ReceiveFormInput) {
  return run("inventory.receive", async () => {
    const v = receiveSchema.parse(input);
    await assertItemsInScope("inventory.receive", v.lines.map((l) => l.itemId));
    return receiveStock(db, v);
  });
}

const useSchema = z.object({
  ticketId: optId,
  purposeId: optId,
  doneBy: optId,
  note: text(1000),
  lines: z.array(z.object({ itemId: id, qty, batchId: optId })).min(1).max(100),
});
export type UseFormInput = z.input<typeof useSchema>;

export async function issueStockAction(input: UseFormInput) {
  return run(["inventory.use", "inventory.use_own_jobs"], async () => {
    const v = useSchema.parse(input);
    const me = await signedInUser();
    if (can(me, "inventory.use")) {
      await assertItemsInScope("inventory.use", v.lines.map((l) => l.itemId));
    } else {
      // Operators: only materials for a job of their own departments.
      if (!v.ticketId) throw new UserFacingError("You can only record materials for your own jobs. Choose the job first.");
      await assertInScope("inventory.use_own_jobs", [await ticketDept(v.ticketId)]);
      await assertItemsInScope("inventory.use_own_jobs", v.lines.map((l) => l.itemId));
    }
    return issueStock(db, v);
  });
}

const adjustSchema = z.object({
  doneBy: optId,
  note: z.string().max(1000),
  lines: z
    .array(
      z.object({
        itemId: id,
        direction: z.enum(["ADD", "REMOVE"]),
        qty,
        reasonId: optId,
        opening: z.boolean().optional(),
        unitCost: z.string().max(20).nullish(),
        batchId: optId,
        newBatchNo: text(40),
        newExpiryDate: date,
      }),
    )
    .min(1)
    .max(100),
});
export type AdjustFormInput = z.input<typeof adjustSchema>;

export async function adjustStockAction(input: AdjustFormInput) {
  return run("inventory.adjust", async () => {
    const v = adjustSchema.parse(input);
    await assertItemsInScope("inventory.adjust", v.lines.map((l) => l.itemId));
    return adjustStock(db, v);
  });
}

export async function reverseDocumentAction(docId: string, reason: string, doneBy: string | null) {
  return run("inventory.adjust", () => reverseDocument(db, id.parse(docId), z.string().max(500).parse(reason), { doneBy: doneBy ? id.parse(doneBy) : null }));
}
