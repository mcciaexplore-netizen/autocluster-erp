"use server";

import { logActivity } from "@/lib/activity";
import { eq } from "drizzle-orm";
import { leads } from "@/db/schema";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { addListItem } from "@/db/crm-lists-writer";
import { linkLeadToCustomer } from "@/db/lead-links";
import { cancelActivity, markActivityDone, planActivity } from "@/db/activity-writer";
import { addStage, deleteStage, moveStage, renameStage, reorderStages, setStageColor, setStageFolded, setStageProbability } from "@/db/stage-writer";
import { todayInIndia } from "@/lib/tickets";
import {
  addLeadNote,
  findDuplicates,
  logLeadContact,
  updateLead,
  type Duplicates,
  bulkAddTag,
  bulkAssign,
  bulkMove,
  createLead,
  deleteLeads,
  moveLead,
  restoreLeads,
  setLeadPriority,
  type MoveResult,
} from "@/db/lead-writer";
import { UserFacingError } from "@/db/quote-writer";
import { allow, moneyView, signedInUser } from "@/lib/auth/guard";
import type { Permission } from "@/lib/auth/permissions";
import { parseRupees } from "@/lib/money-input";
import { parseMobileOrEmail } from "@/lib/crm/contact";
import { getLeadDetail, type LeadDetail } from "@/lib/crm-data";
import { leadFormSchema, leadInputFromForm, type LeadFormValues } from "@/lib/validation/lead";

type Result<T> = { ok: true; data: T } | { ok: false; message: string };

const id = z.string().uuid();
const idList = z.array(id).min(1, { message: "Please tick at least one enquiry." }).max(500);

async function run<T>(perm: Permission | Permission[], fn: () => Promise<T>): Promise<Result<T>> {
  const g = await allow(perm);
  if (!g.ok) return { ok: false, message: g.message };
  try {
    const data = await fn();
    revalidatePath("/", "layout");
    return { ok: true, data };
  } catch (e) {
    if (e instanceof UserFacingError) return { ok: false, message: e.message };
    if (e instanceof z.ZodError) return { ok: false, message: e.issues[0]?.message ?? "Please check the details." };
    console.error(e);
    return { ok: false, message: "We couldn't save that right now. Please try again." };
  }
}

const quickAdd = z.object({
  stageId: id,
  sourceId: z.string().max(100),
  title: z.string().max(300),
  companyName: z.string().max(200),
  contactName: z.string().max(200),
  mobileOrEmail: z.string().max(200),
  expectedValue: z.string().max(30),
});
export type QuickAddInput = z.input<typeof quickAdd>;

/** Quick add from the top of a column. */
/** May the signed-in person see (and so set) sale prices such as expected values? */
async function mayPrices() {
  return moneyView(await signedInUser()).sale;
}

export async function quickAddLeadAction(input: QuickAddInput) {
  return run("crm.edit", async () => {
    const v = quickAdd.parse(input);
    if (!v.sourceId) throw new UserFacingError("Please choose where the enquiry came from (the source).");
    const contact = parseMobileOrEmail(v.mobileOrEmail);
    if (contact.problem) throw new UserFacingError(contact.problem);
    let value: number | null = null;
    if (v.expectedValue.trim()) {
      value = parseRupees(v.expectedValue);
      if (value == null) throw new UserFacingError("The expected value should be an amount in rupees, e.g. 50000.");
    }
    const lead = await createLead(db, {
      stageId: v.stageId,
      sourceId: id.parse(v.sourceId),
      title: v.title,
      companyName: v.companyName,
      contactName: v.contactName,
      phone: contact.phone,
      email: contact.email,
      // Expected values are sale prices: only people who may see them can set them.
      expectedValuePaise: (await mayPrices()) ? value : null,
    });
    return { id: lead.id, leadNo: lead.leadNo };
  });
}

export async function moveLeadAction(leadId: string, stageId: string, lost?: { reasonId: string; note?: string | null }): Promise<Result<MoveResult>> {
  return run("crm.edit", () => moveLead(db, id.parse(leadId), id.parse(stageId), { lostReasonId: lost?.reasonId ?? null, lostNote: lost?.note ?? null }));
}

export async function setLeadPriorityAction(leadId: string, priority: number) {
  return run("crm.edit", () => setLeadPriority(db, id.parse(leadId), z.number().int().min(0).max(3).parse(priority)));
}

export async function bulkMoveAction(leadIds: string[], stageId: string, lost?: { reasonId: string; note?: string | null }) {
  return run("crm.edit", () => bulkMove(db, idList.parse(leadIds), id.parse(stageId), { lostReasonId: lost?.reasonId ?? null, lostNote: lost?.note ?? null }));
}

export async function bulkAssignAction(leadIds: string[], memberId: string | null) {
  return run("crm.edit", () => bulkAssign(db, idList.parse(leadIds), memberId ? id.parse(memberId) : null));
}

export async function bulkAddTagAction(leadIds: string[], tagId: string) {
  return run("crm.edit", () => bulkAddTag(db, idList.parse(leadIds), id.parse(tagId)));
}

export async function deleteLeadsAction(leadIds: string[]) {
  return run("crm.edit", () => deleteLeads(db, idList.parse(leadIds)));
}

export async function restoreLeadsAction(leadIds: string[]) {
  return run("crm.edit", () => restoreLeads(db, idList.parse(leadIds)));
}


// ---- full form, detail panel ----------------------------------------------------------------

export async function loadLeadDetail(leadId: string): Promise<Result<LeadDetail>> {
  const g = await allow("crm.view");
  if (!g.ok) return { ok: false, message: g.message };
  const parsed = id.safeParse(leadId);
  const d = parsed.success ? await getLeadDetail(parsed.data) : null;
  return d ? { ok: true, data: d } : { ok: false, message: "This enquiry could not be found. It may have been deleted." };
}

export async function createLeadAction(values: LeadFormValues) {
  return run("crm.edit", async () => {
    const v = leadFormSchema.parse(values);
    const input = leadInputFromForm(v);
    if (!(await mayPrices())) input.expectedValuePaise = null;
    const lead = await createLead(db, input);
    return { id: lead.id, leadNo: lead.leadNo };
  });
}

export async function updateLeadAction(leadId: string, values: LeadFormValues) {
  return run("crm.edit", async () => {
    const v = leadFormSchema.parse(values);
    const input = leadInputFromForm(v);
    // People who may not see prices never saw the value, so it stays as it was.
    if (!(await mayPrices())) {
      const [l] = await db.select({ v: leads.expectedValue }).from(leads).where(eq(leads.id, id.parse(leadId)));
      input.expectedValuePaise = l?.v ?? null;
    }
    const r = await updateLead(db, id.parse(leadId), input);
    return { changed: r.changed, moved: r.moved };
  });
}

export async function addLeadNoteAction(leadId: string, note: string) {
  return run("crm.edit", () => addLeadNote(db, id.parse(leadId), z.string().max(5000).parse(note)));
}

export async function logLeadContactAction(leadId: string, kind: "CALL" | "WHATSAPP" | "EMAIL") {
  return run("crm.edit", () => logLeadContact(db, id.parse(leadId), z.enum(["CALL", "WHATSAPP", "EMAIL"]).parse(kind)));
}

const dupQuery = z.object({
  phone: z.string().max(30).nullish(),
  email: z.string().max(200).nullish(),
  companyName: z.string().max(200).nullish(),
  excludeLeadId: z.string().uuid().nullish(),
  excludeCustomerId: z.string().uuid().nullish(),
});

/** Read-only: customers and enquiries with the same mobile, email or company name. */
export async function findDuplicatesAction(q: z.input<typeof dupQuery>): Promise<Result<Duplicates>> {
  const g = await allow("crm.view");
  if (!g.ok) return { ok: false, message: g.message };
  const parsed = dupQuery.safeParse(q);
  if (!parsed.success) return { ok: true, data: { customers: [], leads: [] } };
  return { ok: true, data: await findDuplicates(db, parsed.data) };
}

/** "Pick or type a new tag" in the enquiry form. */
export async function createTagAction(name: string) {
  return run("crm.edit", async () => {
    const tag = { id: await addListItem(db, "tags", { name: z.string().max(200).parse(name) }), name: name.trim().replace(/\s+/g, " ") };
    await logActivity({ area: "CRM", action: "tag", summary: `Added tag "${tag.name}"`, entityType: "settings", entityId: null });
    return tag;
  });
}

// ---- activities ---------------------------------------------------------------------------

const planSchema = z.object({
  leadId: id,
  type: z.enum(["CALL", "MEETING", "EMAIL", "WHATSAPP", "SITE_VISIT", "FOLLOW_UP"], { message: "Please choose the type of activity." }),
  dueDate: z.string().max(10),
  dueTime: z.string().max(8).nullish(),
  note: z.string().max(2000).nullish(),
  assignedTo: z.string().uuid().nullable(),
});
export type PlanActivityInput = z.input<typeof planSchema>;

export async function planActivityAction(input: PlanActivityInput) {
  return run("crm.edit", async () => {
    const a = await planActivity(db, planSchema.parse(input), todayInIndia());
    return { id: a.id };
  });
}

export async function markActivityDoneAction(activityId: string, outcome: string) {
  return run("crm.edit", () => markActivityDone(db, id.parse(activityId), z.string().max(2000).parse(outcome)));
}

export async function cancelActivityAction(activityId: string) {
  return run("crm.edit", () => cancelActivity(db, id.parse(activityId)));
}

// ---- stages (Edit stages panel and the column menu) -------------------------------------------

/** Changing the pipeline stages needs "crm.stages". */
async function pipeline<T>(fn: () => Promise<T>) {
  return run("crm.stages", fn);
}
const stageName = z.string().max(200);

export async function setStageFoldedAction(stageId: string, folded: boolean) {
  return pipeline(() => setStageFolded(db, id.parse(stageId), z.boolean().parse(folded)));
}
export async function renameStageAction(stageId: string, name: string) {
  return pipeline(() => renameStage(db, id.parse(stageId), stageName.parse(name)));
}
export async function setStageColorAction(stageId: string, color: string) {
  return pipeline(() => setStageColor(db, id.parse(stageId), z.string().max(20).parse(color)));
}
export async function setStageProbabilityAction(stageId: string, probability: number) {
  return pipeline(() => setStageProbability(db, id.parse(stageId), z.number().parse(probability)));
}
export async function addStageAction(name: string, color?: string) {
  return pipeline(async () => {
    const s = await addStage(db, stageName.parse(name), color);
    return { id: s.id, name: s.name };
  });
}
export async function reorderStagesAction(orderedIds: string[]) {
  return pipeline(() => reorderStages(db, z.array(id).max(50).parse(orderedIds)));
}
export async function moveStageAction(stageId: string, dir: -1 | 1) {
  return pipeline(() => moveStage(db, id.parse(stageId), z.union([z.literal(-1), z.literal(1)]).parse(dir)));
}
export async function deleteStageAction(stageId: string, moveToId: string | null) {
  return pipeline(() => deleteStage(db, id.parse(stageId), moveToId ? id.parse(moveToId) : null));
}

// ---- links to customers and quotations --------------------------------------------------------

/** After "Convert to customer": links the enquiry to the customer just saved. */
export async function linkLeadToCustomerAction(leadId: string, customerId: string) {
  return run("crm.edit", () => linkLeadToCustomer(db, id.parse(leadId), id.parse(customerId)));
}
