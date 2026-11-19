"use server";

import { head } from "@vercel/blob";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { addInvoice, findInvoice } from "@/db/invoice-writer";
import { addPurchaseOrder, DuplicatePoError, findPo, registerFile, type ExistingPo } from "@/db/po-writer";
import { UserFacingError } from "@/db/quote-writer";
import { cancelTicket, moveTicketBack } from "@/db/ticket-writer";
import { isSignedIn } from "@/lib/auth-guard";
import { SIGNED_OUT_MESSAGE } from "@/lib/auth-messages";
import { BLOB_NOT_SET_MESSAGE, blobAuth, blobConfigured, blobEnv } from "@/lib/blob";
import { ALLOWED_FILE_TYPES, isValidUploadPath, MAX_FILE_BYTES, type UploadedFile } from "@/lib/files";
import { getTicketDetail, type TicketDetail } from "@/lib/orders-data";
import { todayInIndia } from "@/lib/tickets";

type Result<T> = { ok: true; data: T } | { ok: false; message: string; duplicate?: ExistingPo };

const id = z.string().uuid();
const reason = z.string().trim().min(3, { message: "Please write a short reason, e.g. “Wrong PO attached”." }).max(300);

function refresh() {
  revalidatePath("/", "layout");
}

async function run<T>(fn: () => Promise<T>): Promise<Result<T>> {
  if (!(await isSignedIn())) return { ok: false, message: SIGNED_OUT_MESSAGE };
  try {
    const data = await fn();
    refresh();
    return { ok: true, data };
  } catch (e) {
    if (e instanceof DuplicatePoError) return { ok: false, message: e.message, duplicate: e.existing };
    if (e instanceof UserFacingError) return { ok: false, message: e.message };
    if (e instanceof z.ZodError) return { ok: false, message: e.issues[0]?.message ?? "Please check the details." };
    console.error(e);
    return { ok: false, message: "We couldn't save that right now. Please try again." };
  }
}

export async function loadTicketDetail(ticketId: string): Promise<Result<TicketDetail>> {
  if (!(await isSignedIn())) return { ok: false, message: SIGNED_OUT_MESSAGE };
  const d = await getTicketDetail(ticketId);
  return d ? { ok: true, data: d } : { ok: false, message: "This ticket could not be found." };
}

export async function moveTicketBackAction(ticketId: string, why: string) {
  return run(() => moveTicketBack(db, id.parse(ticketId), reason.parse(why)));
}

export async function cancelTicketAction(ticketId: string, why: string) {
  return run(() => cancelTicket(db, id.parse(ticketId), reason.parse(why)));
}

// ---- files ------------------------------------------------------------------------

const uploadInput = z.object({
  pathname: z.string().min(1).max(200),
  fileName: z.string().trim().min(1).max(200),
  kind: z.enum(["PO", "INVOICE"]),
});

/** Records a file the browser just uploaded to Blob, after checking it really is there and allowed. */
export async function registerUpload(input: z.input<typeof uploadInput>): Promise<Result<UploadedFile>> {
  if (!(await isSignedIn())) return { ok: false, message: SIGNED_OUT_MESSAGE };
  if (!blobConfigured()) return { ok: false, message: BLOB_NOT_SET_MESSAGE };
  const parsed = uploadInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That upload didn't look right. Please try again." };
  const { pathname, fileName, kind } = parsed.data;
  // Blob adds a random suffix before the extension, so check the folder part only.
  const folder = `${blobEnv()}/${kind === "PO" ? "po" : "invoice"}/`;
  if (!pathname.startsWith(folder) || !isValidUploadPath(pathname, blobEnv())) return { ok: false, message: "That upload didn't look right. Please try again." };
  try {
    const info = await head(pathname, blobAuth());
    if (!(ALLOWED_FILE_TYPES as readonly string[]).includes(info.contentType) || info.size > MAX_FILE_BYTES) {
      return { ok: false, message: "Please choose a PDF, JPG or PNG file up to 10 MB." };
    }
    const id = await registerFile(db, { kind, blobPath: pathname, fileName, size: info.size, mime: info.contentType });
    return { ok: true, data: { id, name: fileName, size: info.size } };
  } catch (e) {
    console.error("registerUpload", e);
    return { ok: false, message: "We couldn't save that file. Please try uploading it again." };
  }
}

// ---- purchase orders ----------------------------------------------------------------

/** Live check while typing: does this customer already have this PO number? */
export async function checkPoNumber(customerId: string, poNumber: string): Promise<Result<ExistingPo | null>> {
  if (!(await isSignedIn())) return { ok: false, message: SIGNED_OUT_MESSAGE };
  if (!id.safeParse(customerId).success) return { ok: true, data: null };
  return { ok: true, data: await findPo(db, customerId, poNumber.slice(0, 100)) };
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Please enter the PO date." });
const addPoInput = z.union([
  z.object({
    ticketIds: z.array(id).min(1, { message: "Please tick at least one service." }).max(100),
    existingPoId: id,
  }),
  z.object({
    ticketIds: z.array(id).min(1, { message: "Please tick at least one service." }).max(100),
    poNumber: z.string().trim().min(1, { message: "Please enter the PO number." }).max(60, { message: "Please keep the PO number under 60 characters." }),
    poDate: isoDate,
    poAmountPaise: z.number().int().positive({ message: "Please enter the PO amount." }).max(100_000_000_000),
    fileId: id.nullable(),
    notes: z.string().trim().max(500).nullable(),
  }),
]);

export async function addPoAction(input: z.input<typeof addPoInput>) {
  return run(() => addPurchaseOrder(db, addPoInput.parse(input), todayInIndia()));
}

// ---- tax invoices ---------------------------------------------------------------------

/** Live check while typing: is this invoice number already used? Returns a message or null. */
export async function checkInvoiceNumber(invoiceNumber: string): Promise<Result<string | null>> {
  if (!(await isSignedIn())) return { ok: false, message: SIGNED_OUT_MESSAGE };
  const used = await findInvoice(db, invoiceNumber.slice(0, 100));
  return { ok: true, data: used ? `Invoice number ${used.number} is already used (${used.company}). Please check the number.` : null };
}

const addInvoiceInput = z.object({
  ticketIds: z.array(id).min(1, { message: "Please tick at least one service." }).max(100),
  invoiceNumber: z.string().trim().min(1, { message: "Please enter the invoice number." }).max(60, { message: "Please keep the invoice number under 60 characters." }),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Please enter the invoice date." }),
  amountPaise: z.number().int().positive({ message: "Please enter the invoice amount." }).max(100_000_000_000),
  creditDays: z.number().int().min(0).max(365, { message: "Credit period should be between 0 and 365 days." }),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Please enter the due date." }),
  fileId: id,
});

export async function addInvoiceAction(input: z.input<typeof addInvoiceInput>) {
  return run(() => addInvoice(db, addInvoiceInput.parse(input), todayInIndia()));
}
