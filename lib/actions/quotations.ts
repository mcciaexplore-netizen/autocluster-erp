"use server";

import { isSignedIn } from "@/lib/auth-guard";
import { SIGNED_OUT_MESSAGE } from "@/lib/auth-messages";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { createQuotation, updateQuotation, UserFacingError, type QuotationInput } from "@/db/quote-writer";
import { quotationItems, quotations, settings as settingsTable } from "@/db/schema";
import { addDaysIso, todayIso } from "@/lib/format";
import { lineProblems, type DraftLine } from "@/lib/quote-calc";
import { itemToDraft } from "@/lib/quote-items";

type Result<T> = { ok: true; data: T } | { ok: false; message: string };

const statusSchema = z.enum(["DRAFT", "SENT", "ACCEPTED", "REJECTED"]);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const num = z.number().finite().nonnegative().nullable().optional();

const lineSchema = z.object({
  key: z.string(),
  serviceId: z.number().int().nullable(),
  deptCode: z.string().nullable(),
  description: z.string().trim().min(1).max(300),
  unitType: z.enum(["PER_CC", "PER_HOUR", "PER_SAMPLE", "PER_HOUR_3_SAMPLES"]).nullable(),
  unitLabel: z.string().trim().max(60),
  ccPerPart: num,
  parts: z.number().int().nonnegative().nullable().optional(),
  hours: num,
  samples: z.number().int().nonnegative().nullable().optional(),
  quantity: num,
  customRatePaise: z.number().int().nonnegative().nullable(),
  notes: z.string().max(500).nullable().optional(),
  locked: z.object({ listRatePaise: z.number().int().nonnegative(), discountPct: z.number().min(0).max(100) }).nullable().optional(),
});

const inputSchema = z.object({
  customerId: z.string().uuid({ message: "Please choose a customer." }),
  quoteDate: dateSchema,
  validUntil: dateSchema,
  subject: z.string().trim().min(1, { message: "Please enter a subject." }).max(300),
  notes: z.string().trim().max(3000).nullable(),
  terms: z.string().trim().max(6000),
  status: statusSchema,
  lines: z.array(lineSchema).min(1, { message: "Please add at least one service." }).max(100),
});

function refresh() {
  revalidatePath("/", "layout");
}

function check(input: unknown): { ok: true; data: QuotationInput } | { ok: false; message: string } {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    // Our own messages are plain words; anything else gets a friendly fallback.
    const friendly = issue?.code === "custom" || issue?.path.length === 1 ? issue.message : null;
    const where = issue?.path[0] === "lines" && typeof issue.path[1] === "number" ? `Service ${issue.path[1] + 1}: ` : "";
    return { ok: false, message: friendly && !/expected|invalid/i.test(friendly) ? friendly : `${where}Some details need a second look. Please check and try again.` };
  }
  const data = parsed.data as QuotationInput;
  if (data.validUntil < data.quoteDate) return { ok: false, message: "“Valid until” must be on or after the quotation date." };
  for (const [i, l] of data.lines.entries()) {
    const p = lineProblems(l as DraftLine);
    if (p.length) return { ok: false, message: `Service ${i + 1}: ${p[0]}` };
  }
  return { ok: true, data };
}

export async function saveQuotation(
  input: QuotationInput,
  id: string | null,
): Promise<Result<{ id: string; quoteNo: string }>> {
  if (!(await isSignedIn())) return { ok: false as const, message: SIGNED_OUT_MESSAGE };
  const c = check(input);
  if (!c.ok) return c;
  try {
    const q = id ? await updateQuotation(db, id, c.data) : await createQuotation(db, c.data);
    refresh();
    return { ok: true, data: q };
  } catch (e) {
    if (e instanceof UserFacingError) return { ok: false, message: e.message };
    console.error(e);
    return { ok: false, message: "We couldn't save the quotation right now. Please try again." };
  }
}

export async function setQuotationStatus(id: string, status: z.infer<typeof statusSchema>): Promise<Result<null>> {
  if (!(await isSignedIn())) return { ok: false as const, message: SIGNED_OUT_MESSAGE };
  const s = statusSchema.safeParse(status);
  if (!s.success) return { ok: false, message: "Unknown status." };
  const [row] = await db
    .update(quotations)
    .set({ status: s.data })
    .where(and(eq(quotations.id, id), isNull(quotations.deletedAt)))
    .returning({ id: quotations.id });
  if (!row) return { ok: false, message: "This quotation could not be found." };
  refresh();
  return { ok: true, data: null };
}

/**
 * Makes a new draft from an existing quotation: new number, today's date,
 * same customer and services at the SAME rates as the original.
 */
export async function duplicateQuotation(id: string): Promise<Result<{ id: string; quoteNo: string }>> {
  if (!(await isSignedIn())) return { ok: false as const, message: SIGNED_OUT_MESSAGE };
  const [q] = await db.select().from(quotations).where(and(eq(quotations.id, id), isNull(quotations.deletedAt)));
  if (!q) return { ok: false, message: "This quotation could not be found." };
  const items = await db.select().from(quotationItems).where(eq(quotationItems.quotationId, id)).orderBy(quotationItems.sortOrder);
  const [settings] = await db.select().from(settingsTable).where(eq(settingsTable.id, 1));
  const today = todayIso();
  const lines: DraftLine[] = items.map((it) => itemToDraft(it));
  const res = await saveQuotation(
    {
      customerId: q.customerId,
      quoteDate: today,
      validUntil: addDaysIso(today, settings?.quoteValidityDays ?? 30),
      subject: q.subject,
      notes: q.notes,
      terms: q.terms,
      status: "DRAFT",
      lines,
    },
    null,
  );
  return res;
}
