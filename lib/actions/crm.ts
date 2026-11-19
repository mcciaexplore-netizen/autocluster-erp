"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import {
  bulkAddTag,
  bulkAssign,
  bulkMove,
  createLead,
  deleteLeads,
  moveLead,
  restoreLeads,
  setLeadPriority,
  setStageFolded,
  type MoveResult,
} from "@/db/lead-writer";
import { UserFacingError } from "@/db/quote-writer";
import { isSignedIn } from "@/lib/auth-guard";
import { SIGNED_OUT_MESSAGE } from "@/lib/auth-messages";
import { canManagePipeline } from "@/lib/crm/permissions";
import { parseRupees } from "@/lib/money-input";
import { parseMobileOrEmail } from "@/lib/crm/contact";

type Result<T> = { ok: true; data: T } | { ok: false; message: string };

const id = z.string().uuid();
const idList = z.array(id).min(1, { message: "Please tick at least one enquiry." }).max(500);

async function run<T>(fn: () => Promise<T>): Promise<Result<T>> {
  if (!(await isSignedIn())) return { ok: false, message: SIGNED_OUT_MESSAGE };
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
export async function quickAddLeadAction(input: QuickAddInput) {
  return run(async () => {
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
      expectedValuePaise: value,
    });
    return { id: lead.id, leadNo: lead.leadNo };
  });
}

export async function moveLeadAction(leadId: string, stageId: string, lost?: { reasonId: string; note?: string | null }): Promise<Result<MoveResult>> {
  return run(() => moveLead(db, id.parse(leadId), id.parse(stageId), { lostReasonId: lost?.reasonId ?? null, lostNote: lost?.note ?? null }));
}

export async function setLeadPriorityAction(leadId: string, priority: number) {
  return run(() => setLeadPriority(db, id.parse(leadId), z.number().int().min(0).max(3).parse(priority)));
}

export async function bulkMoveAction(leadIds: string[], stageId: string, lost?: { reasonId: string; note?: string | null }) {
  return run(() => bulkMove(db, idList.parse(leadIds), id.parse(stageId), { lostReasonId: lost?.reasonId ?? null, lostNote: lost?.note ?? null }));
}

export async function bulkAssignAction(leadIds: string[], memberId: string | null) {
  return run(() => bulkAssign(db, idList.parse(leadIds), memberId ? id.parse(memberId) : null));
}

export async function bulkAddTagAction(leadIds: string[], tagId: string) {
  return run(() => bulkAddTag(db, idList.parse(leadIds), id.parse(tagId)));
}

export async function deleteLeadsAction(leadIds: string[]) {
  return run(() => deleteLeads(db, idList.parse(leadIds)));
}

export async function restoreLeadsAction(leadIds: string[]) {
  return run(() => restoreLeads(db, idList.parse(leadIds)));
}

export async function setStageFoldedAction(stageId: string, folded: boolean) {
  return run(async () => {
    if (!(await canManagePipeline())) throw new UserFacingError("Only an admin can change the stages.");
    await setStageFolded(db, id.parse(stageId), z.boolean().parse(folded));
  });
}
