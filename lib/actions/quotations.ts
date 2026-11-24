"use server";

import { logActivity } from "@/lib/activity";
import { allow } from "@/lib/auth/guard";
import type { Permission } from "@/lib/auth/permissions";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { createQuotation, UserFacingError, type QuotationInput } from "@/db/quote-writer";
import { createQuotationFromLead, updateQuotationAndLead } from "@/db/lead-links";
import { changeQuotationStatus, planStatusChange, type StatusChangePlan } from "@/db/ticket-writer";
import { todayInIndia } from "@/lib/tickets";
import { leads, quotationItems, quotations, settings as settingsTable } from "@/db/schema";
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
  leadId: z.string().uuid().nullish(),
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

/** Marking Accepted or Rejected needs "quotes.status"; other moves (e.g. Sent) are part of editing. */
function statusPerm(status: unknown): Permission {
  return status === "ACCEPTED" || status === "REJECTED" ? "quotes.status" : "quotes.edit";
}

export async function saveQuotation(
  input: QuotationInput,
  id: string | null,
): Promise<Result<{ id: string; quoteNo: string; movedTo?: string | null }>> {
  const g = await allow("quotes.edit");
  if (!g.ok) return { ok: false as const, message: g.message };
  const c = check(input);
  if (!c.ok) return c;
  try {
    // An existing quotation keeps its enquiry link; a new one made from an enquiry gets it here.
    const { leadId, ...data } = c.data;
    const q = id ? await updateQuotationAndLead(db, id, data) : leadId ? await createQuotationFromLead(db, data, leadId) : await createQuotation(db, data);
    await logActivity({ area: "Quotations", action: id ? "changed" : "created", summary: `${id ? "Changed" : "Created"} quotation ${q.quoteNo}`, entityType: "quotation", entityId: q.id });
    refresh();
    return { ok: true, data: q };
  } catch (e) {
    if (e instanceof UserFacingError) return { ok: false, message: e.message };
    console.error(e);
    return { ok: false, message: "We couldn't save the quotation right now. Please try again." };
  }
}

/** What changing the status would do to the quotation's tickets, so the screen can ask first. */
export async function previewStatusChange(id: string, status: z.infer<typeof statusSchema>): Promise<Result<StatusChangePlan>> {
  const g = await allow(statusPerm(status));
  if (!g.ok) return { ok: false as const, message: g.message };
  const s = statusSchema.safeParse(status);
  if (!s.success) return { ok: false, message: "Unknown status." };
  return { ok: true, data: await planStatusChange(db, id, s.data) };
}

export async function setQuotationStatus(
  id: string,
  status: z.infer<typeof statusSchema>,
): Promise<Result<{ opened: number; reopened: number; cancelled: number; leadWon: string | null }>> {
  const g = await allow(statusPerm(status));
  if (!g.ok) return { ok: false as const, message: g.message };
  const s = statusSchema.safeParse(status);
  if (!s.success) return { ok: false, message: "Unknown status." };
  try {
    const r = await changeQuotationStatus(db, id, s.data, todayInIndia());
    const [qn] = await db.select({ no: quotations.quoteNo }).from(quotations).where(eq(quotations.id, id));
    await logActivity({ area: "Quotations", action: "status", summary: `Marked quotation ${qn?.no ?? ""} ${s.data.toLowerCase()}`, entityType: "quotation", entityId: id });
    refresh();
    return { ok: true, data: r };
  } catch (e) {
    if (e instanceof UserFacingError) return { ok: false, message: e.message };
    console.error(e);
    return { ok: false, message: "We couldn't change the status right now. Please try again." };
  }
}

/**
 * Makes a new draft from an existing quotation: new number, today's date,
 * same customer and services at the SAME rates as the original.
 */
async function liveLead(id: string) {
  const [l] = await db.select({ id: leads.id }).from(leads).where(and(eq(leads.id, id), isNull(leads.deletedAt)));
  return !!l;
}

export async function duplicateQuotation(id: string): Promise<Result<{ id: string; quoteNo: string }>> {
  const g = await allow("quotes.edit");
  if (!g.ok) return { ok: false as const, message: g.message };
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
      // A revision stays linked to the same enquiry (and updates its expected value).
      ...(q.leadId && (await liveLead(q.leadId)) ? { leadId: q.leadId } : {}),
    },
    null,
  );
  return res;
}
