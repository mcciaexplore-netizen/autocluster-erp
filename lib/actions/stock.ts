"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { UserFacingError } from "@/db/quote-writer";
import { adjustStock, receiveStock, reverseDocument, issueStock } from "@/db/stock-writer";
import { isSignedIn } from "@/lib/auth-guard";
import { SIGNED_OUT_MESSAGE } from "@/lib/auth-messages";

type Result<T> = { ok: true; data: T } | { ok: false; message: string };

const id = z.string().uuid();
const optId = z.string().uuid().nullish().or(z.literal("").transform(() => null));
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().or(z.literal("").transform(() => null));
const text = (max: number) => z.string().max(max).nullish();
const qty = z.string().max(20);

async function run<T>(fn: () => Promise<T>): Promise<Result<T>> {
  if (!(await isSignedIn())) return { ok: false, message: SIGNED_OUT_MESSAGE };
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
  return run(() => receiveStock(db, receiveSchema.parse(input)));
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
  return run(() => issueStock(db, useSchema.parse(input)));
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
        reasonId: z.string().min(1, { message: "Please choose the reason." }).pipe(id),
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
  return run(() => adjustStock(db, adjustSchema.parse(input)));
}

export async function reverseDocumentAction(docId: string, reason: string, doneBy: string | null) {
  return run(() => reverseDocument(db, id.parse(docId), z.string().max(500).parse(reason), { doneBy: doneBy ? id.parse(doneBy) : null }));
}
