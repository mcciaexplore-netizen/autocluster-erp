/**
 * Writing CRM enquiries (leads). Kept free of Next.js imports so scripts and tests can use it.
 *
 * Rules enforced here:
 * - Enquiry numbers come from a counter row locked inside the transaction, so they are unique
 *   even when many are created at the same moment, and never reused.
 * - Moving to the Lost stage needs a lost reason. Moving to Won records when it was won.
 *   Moving a Won or Lost enquiry back to an open stage reopens it.
 * - Every change is written to the enquiry's history (lead_events).
 */
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { EMAIL_PROBLEM, EMAIL_RE, MOBILE_PROBLEM, normalizeMobile } from "@/lib/crm/contact";
import { MOBILE_REGEX } from "@/lib/india";
import { financialYear, formatINRShort, formatQuoteNo } from "@/lib/pricing";
import { todayInIndia } from "@/lib/tickets";
import type { DB, Tx } from "./client";
import { UserFacingError } from "./quote-writer";
import {
  crmLostReasons,
  crmSources,
  crmStageChanges,
  crmStages,
  crmTags,
  customers,
  departments,
  leadCounters,
  leadDepartments,
  leadEvents,
  leads,
  leadServices,
  leadTags,
  services,
  settings,
  teamMembers,
  type CrmStage,
} from "./schema";

export const ACTOR = "Demo User";
const ids = (list: string[]) => sql`any(${sql.param(list)}::uuid[])`;

export type Category = "OEM" | "TIER1" | "TIER2" | "MSME";

export interface LeadInput {
  title: string;
  sourceId?: string | null;
  stageId?: string | null;
  customerId?: string | null;
  companyName: string;
  contactName: string;
  designation?: string | null;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  category?: Category | null;
  isMcciaMember?: boolean | null;
  mcciaMembershipId?: string | null;
  deptCodes?: string[];
  serviceIds?: number[];
  expectedValuePaise?: number | null;
  expectedCloseDate?: string | null;
  priority?: number;
  assignedTo?: string | null;
  tagIds?: string[];
  notes?: string | null;
}

// ---- small helpers -------------------------------------------------------------------

export { normalizeMobile };

const clean = (v: string | null | undefined) => {
  const t = (v ?? "").trim().replace(/\s+/g, " ");
  return t || null;
};

export async function logLeadEvent(db: DB | Tx, leadId: string, type: string, message: string, data?: Record<string, unknown>) {
  await db.insert(leadEvents).values({ leadId, type, message, data: data ?? null, createdBy: ACTOR });
}

/** Atomically takes the next enquiry number for a financial year. */
async function nextLeadSeq(tx: Tx, fy: string): Promise<number> {
  const [row] = await tx
    .insert(leadCounters)
    .values({ fy, lastSeq: 1 })
    .onConflictDoUpdate({ target: leadCounters.fy, set: { lastSeq: sql`${leadCounters.lastSeq} + 1` } })
    .returning({ seq: leadCounters.lastSeq });
  return row.seq;
}

export async function stagesInOrder(db: DB | Tx): Promise<CrmStage[]> {
  return db.select().from(crmStages).orderBy(asc(crmStages.sortOrder), asc(crmStages.createdAt));
}

/** Checks and tidies the enquiry details. Throws a plain-words error on the first problem. */
async function cleanInput(tx: Tx, input: LeadInput) {
  const title = clean(input.title);
  if (!title) throw new UserFacingError("Please enter the enquiry title, e.g. “3D printing of 20 prototype parts”.");
  if (title.length > 200) throw new UserFacingError("Please keep the enquiry title under 200 characters.");
  const companyName = clean(input.companyName);
  if (!companyName) throw new UserFacingError("Please enter the company name.");
  const contactName = clean(input.contactName);
  if (!contactName) throw new UserFacingError("Please enter the contact person's name.");
  const phone = normalizeMobile(input.phone);
  if (phone && !MOBILE_REGEX.test(phone)) throw new UserFacingError(MOBILE_PROBLEM);
  const email = clean(input.email)?.toLowerCase() ?? null;
  if (email && !EMAIL_RE.test(email)) throw new UserFacingError(EMAIL_PROBLEM);
  if (!phone && !email) throw new UserFacingError("Please enter a mobile number or an email address, so we can reach them.");
  const priority = input.priority ?? 0;
  if (!Number.isInteger(priority) || priority < 0 || priority > 3) throw new UserFacingError("Priority must be 0 to 3 stars.");
  const value = input.expectedValuePaise ?? null;
  if (value != null && (!Number.isSafeInteger(value) || value < 0)) throw new UserFacingError("The expected value doesn't look right.");
  const close = input.expectedCloseDate || null;
  if (close && !/^\d{4}-\d{2}-\d{2}$/.test(close)) throw new UserFacingError("The expected close date doesn't look right.");

  if (input.customerId) {
    const [c] = await tx.select({ id: customers.id, deletedAt: customers.deletedAt }).from(customers).where(eq(customers.id, input.customerId));
    if (!c || c.deletedAt) throw new UserFacingError("The linked customer could not be found.");
  }
  if (input.assignedTo) {
    const [m] = await tx.select({ id: teamMembers.id }).from(teamMembers).where(eq(teamMembers.id, input.assignedTo));
    if (!m) throw new UserFacingError("That team member could not be found.");
  }
  const deptCodes = [...new Set(input.deptCodes ?? [])];
  if (deptCodes.length) {
    const found = await tx.select({ code: departments.code }).from(departments).where(inArray(departments.code, deptCodes));
    if (found.length !== deptCodes.length) throw new UserFacingError("One of the departments could not be found.");
  }
  const serviceIds = [...new Set(input.serviceIds ?? [])];
  if (serviceIds.length) {
    const found = await tx.select({ id: services.id }).from(services).where(inArray(services.id, serviceIds));
    if (found.length !== serviceIds.length) throw new UserFacingError("One of the services could not be found.");
  }
  const tagIds = [...new Set(input.tagIds ?? [])];
  if (tagIds.length) {
    const found = await tx.select({ id: crmTags.id }).from(crmTags).where(inArray(crmTags.id, tagIds));
    if (found.length !== tagIds.length) throw new UserFacingError("One of the tags could not be found.");
  }
  const membership = input.isMcciaMember ? clean(input.mcciaMembershipId) : null;

  return {
    row: {
      title,
      customerId: input.customerId || null,
      companyName,
      contactName,
      designation: clean(input.designation),
      phone,
      email,
      city: clean(input.city),
      category: input.category ?? null,
      isMcciaMember: input.isMcciaMember ?? null,
      mcciaMembershipId: membership,
      priority,
      expectedValue: value,
      expectedCloseDate: close,
      assignedTo: input.assignedTo || null,
      notes: clean(input.notes) ? (input.notes ?? "").trim() : null,
    },
    deptCodes,
    serviceIds,
    tagIds,
  };
}

/** The source used when none is given (quick add): "Other", else the first one in the list. */
async function defaultSourceId(tx: Tx): Promise<string> {
  const rows = await tx.select({ id: crmSources.id, name: crmSources.name }).from(crmSources).where(eq(crmSources.isActive, true)).orderBy(asc(crmSources.sortOrder));
  const pick = rows.find((r) => r.name.toLowerCase() === "other") ?? rows[0];
  if (!pick) throw new UserFacingError("Please add an enquiry source in Settings > CRM lists first.");
  return pick.id;
}

// ---- create ----------------------------------------------------------------------------

export async function createLead(db: DB | Tx, input: LeadInput, opts: { createdAt?: Date } = {}) {
  return db.transaction(async (tx) => {
    const { row, deptCodes, serviceIds, tagIds } = await cleanInput(tx, input);
    const stages = await stagesInOrder(tx);
    const stage = input.stageId ? stages.find((s) => s.id === input.stageId) : stages.find((s) => s.type === "OPEN");
    if (!stage) throw new UserFacingError("That stage could not be found. Please refresh the page.");
    if (stage.type === "LOST") throw new UserFacingError("A new enquiry can't start as Lost. Add it, then mark it as lost with a reason.");
    let sourceId = input.sourceId || null;
    if (sourceId) {
      const [src] = await tx.select({ id: crmSources.id }).from(crmSources).where(eq(crmSources.id, sourceId));
      if (!src) throw new UserFacingError("That source could not be found.");
    } else sourceId = await defaultSourceId(tx);

    const [set] = await tx.select({ prefix: settings.leadPrefix }).from(settings).where(eq(settings.id, 1));
    const createdAt = opts.createdAt ?? new Date();
    const fy = financialYear(new Date(`${todayInIndia(createdAt)}T00:00:00`));
    const seq = await nextLeadSeq(tx, fy);
    const leadNo = formatQuoteNo(set?.prefix ?? "ACDRI/EN", fy, seq);
    const [lead] = await tx
      .insert(leads)
      .values({
        ...row,
        leadNo,
        fy,
        seq,
        sourceId,
        stageId: stage.id,
        wonAt: stage.type === "WON" ? createdAt : null,
        stageChangedAt: createdAt,
        createdAt,
        updatedAt: createdAt,
      })
      .returning();
    if (deptCodes.length) await tx.insert(leadDepartments).values(deptCodes.map((deptCode) => ({ leadId: lead.id, deptCode })));
    if (serviceIds.length) await tx.insert(leadServices).values(serviceIds.map((serviceId) => ({ leadId: lead.id, serviceId })));
    if (tagIds.length) await tx.insert(leadTags).values(tagIds.map((tagId) => ({ leadId: lead.id, tagId })));
    await tx.insert(leadEvents).values({ leadId: lead.id, type: "CREATED", message: `Enquiry created in ${stage.name}`, createdBy: ACTOR, createdAt });
    return lead;
  });
}

// ---- move between stages -------------------------------------------------------------

export interface MoveResult {
  leadId: string;
  leadNo: string;
  companyName: string;
  customerId: string | null;
  fromType: CrmStage["type"];
  toType: CrmStage["type"];
  toName: string;
  changed: boolean;
}

async function lockLead(tx: Tx, leadId: string) {
  const [lead] = await tx.select().from(leads).where(eq(leads.id, leadId)).for("update");
  if (!lead || lead.deletedAt) throw new UserFacingError("This enquiry could not be found. It may have been deleted.");
  return lead;
}

/**
 * Moves an enquiry to another stage.
 * - To Lost: a lost reason is required.
 * - To Won: records when it was won.
 * - From Won/Lost to an open stage: reopens it.
 */
export async function moveLead(
  db: DB | Tx,
  leadId: string,
  toStageId: string,
  opts: { lostReasonId?: string | null; lostNote?: string | null; message?: string } = {},
): Promise<MoveResult> {
  return db.transaction(async (tx) => {
    const lead = await lockLead(tx, leadId);
    const stages = await stagesInOrder(tx);
    const from = stages.find((s) => s.id === lead.stageId)!;
    const to = stages.find((s) => s.id === toStageId);
    if (!to) throw new UserFacingError("That stage no longer exists. Please refresh the page.");
    const base = { leadId, leadNo: lead.leadNo, companyName: lead.companyName, customerId: lead.customerId, fromType: from.type, toType: to.type, toName: to.name };
    if (from.id === to.id) return { ...base, changed: false };

    const now = new Date();
    const patch: Partial<typeof leads.$inferInsert> = { stageId: to.id, stageChangedAt: now };
    let type = "STAGE";
    let message = opts.message ?? `Moved from ${from.name} to ${to.name}`;
    const data: Record<string, unknown> = { from: from.name, to: to.name };

    if (to.type === "LOST") {
      if (!opts.lostReasonId) throw new UserFacingError("Please choose why the enquiry was lost.");
      const [reason] = await tx.select().from(crmLostReasons).where(eq(crmLostReasons.id, opts.lostReasonId));
      if (!reason) throw new UserFacingError("That lost reason could not be found. Please choose another.");
      const note = clean(opts.lostNote);
      Object.assign(patch, { lostReasonId: reason.id, lostNote: note, lostAt: now, wonAt: null });
      type = "LOST";
      message = opts.message ?? `Marked as lost: ${reason.name}${note ? `. ${note}` : ""}`;
      data.reason = reason.name;
    } else if (to.type === "WON") {
      Object.assign(patch, { wonAt: now, lostAt: null, lostReasonId: null, lostNote: null });
      type = "WON";
      message = opts.message ?? `Marked as won (moved from ${from.name})`;
    } else if (from.type !== "OPEN") {
      Object.assign(patch, { wonAt: null, lostAt: null, lostReasonId: null, lostNote: null });
      type = "REOPENED";
      message = opts.message ?? `Reopened: moved from ${from.name} to ${to.name}`;
    }
    await tx.update(leads).set(patch).where(eq(leads.id, leadId));
    await logLeadEvent(tx, leadId, type, message, data);
    return { ...base, changed: true };
  });
}

// ---- small edits ------------------------------------------------------------------------

export async function setLeadPriority(db: DB, leadId: string, priority: number) {
  if (!Number.isInteger(priority) || priority < 0 || priority > 3) throw new UserFacingError("Priority must be 0 to 3 stars.");
  const r = await db.update(leads).set({ priority }).where(and(eq(leads.id, leadId), isNull(leads.deletedAt))).returning({ id: leads.id });
  if (!r.length) throw new UserFacingError("This enquiry could not be found.");
}

// ---- bulk actions (list view) ------------------------------------------------------------

async function liveLeads(tx: Tx, leadIds: string[]) {
  if (!leadIds.length) throw new UserFacingError("Please tick at least one enquiry.");
  const rows = await tx.select().from(leads).where(and(sql`${leads.id} = ${ids(leadIds)}`, isNull(leads.deletedAt))).for("update");
  if (rows.length !== new Set(leadIds).size) throw new UserFacingError("Some of these enquiries could not be found. Please refresh the page.");
  return rows;
}

export async function bulkMove(db: DB, leadIds: string[], toStageId: string, opts: { lostReasonId?: string | null; lostNote?: string | null } = {}) {
  return db.transaction(async (tx) => {
    await liveLeads(tx, leadIds);
    let moved = 0;
    for (const id of leadIds) if ((await moveLead(tx, id, toStageId, opts)).changed) moved++;
    return { moved };
  });
}

export async function bulkAssign(db: DB, leadIds: string[], memberId: string | null) {
  return db.transaction(async (tx) => {
    const rows = await liveLeads(tx, leadIds);
    let name = "nobody";
    if (memberId) {
      const [m] = await tx.select().from(teamMembers).where(eq(teamMembers.id, memberId));
      if (!m) throw new UserFacingError("That team member could not be found.");
      name = m.name;
    }
    const members = new Map((await tx.select({ id: teamMembers.id, name: teamMembers.name }).from(teamMembers)).map((m) => [m.id, m.name]));
    let changed = 0;
    for (const l of rows) {
      if (l.assignedTo === memberId) continue;
      await tx.update(leads).set({ assignedTo: memberId }).where(eq(leads.id, l.id));
      const before = l.assignedTo ? (members.get(l.assignedTo) ?? "someone") : "nobody";
      await logLeadEvent(tx, l.id, "FIELD", `Assigned to changed from ${before} to ${name}`, { field: "assignedTo", from: before, to: name });
      changed++;
    }
    return { changed };
  });
}

export async function bulkAddTag(db: DB, leadIds: string[], tagId: string) {
  return db.transaction(async (tx) => {
    await liveLeads(tx, leadIds);
    const [tag] = await tx.select().from(crmTags).where(eq(crmTags.id, tagId));
    if (!tag) throw new UserFacingError("That tag could not be found.");
    const added = await tx
      .insert(leadTags)
      .values(leadIds.map((leadId) => ({ leadId, tagId })))
      .onConflictDoNothing()
      .returning({ leadId: leadTags.leadId });
    for (const a of added) await logLeadEvent(tx, a.leadId, "FIELD", `Tag added: ${tag.name}`, { field: "tags", added: tag.name });
    return { added: added.length };
  });
}

/** Soft delete: the enquiry disappears from the board and lists, and can be restored (Undo). */
export async function deleteLeads(db: DB, leadIds: string[]) {
  return db.transaction(async (tx) => {
    const rows = await liveLeads(tx, leadIds);
    await tx.update(leads).set({ deletedAt: new Date() }).where(sql`${leads.id} = ${ids(leadIds)}`);
    for (const l of rows) await logLeadEvent(tx, l.id, "DELETED", "Enquiry deleted");
    return { deleted: rows.length };
  });
}

export async function restoreLeads(db: DB, leadIds: string[]) {
  return db.transaction(async (tx) => {
    const r = await tx
      .update(leads)
      .set({ deletedAt: null })
      .where(and(sql`${leads.id} = ${ids(leadIds)}`, sql`${leads.deletedAt} is not null`))
      .returning({ id: leads.id });
    for (const l of r) await logLeadEvent(tx, l.id, "RESTORED", "Enquiry restored (delete undone)");
    return { restored: r.length };
  });
}

// ---- stage folding (board) ---------------------------------------------------------------

export async function setStageFolded(db: DB, stageId: string, folded: boolean) {
  return db.transaction(async (tx) => {
    const [st] = await tx.update(crmStages).set({ isFolded: folded }).where(eq(crmStages.id, stageId)).returning();
    if (!st) throw new UserFacingError("That stage no longer exists. Please refresh the page.");
    await tx.insert(crmStageChanges).values({ action: folded ? "FOLD" : "UNFOLD", details: { stage: st.name }, createdBy: ACTOR });
  });
}

// ---- edit ------------------------------------------------------------------------------------

const FIELD_LABELS: Record<string, string> = {
  title: "title",
  companyName: "company",
  contactName: "contact person",
  designation: "designation",
  phone: "mobile",
  email: "email",
  city: "city",
  category: "company category",
  isMcciaMember: "MCCIA member",
  mcciaMembershipId: "membership ID",
  notes: "notes",
  expectedCloseDate: "expected close date",
  customerId: "linked customer",
};

const rupees = (p: number | null) => (p == null ? "not set" : formatINRShort(p));

/**
 * Saves the full enquiry form. Value, assignee, priority and source changes get their own
 * history line; other edits are listed together. A stage change follows the usual rules
 * (Lost needs "Mark as lost", so the reason is recorded).
 */
export async function updateLead(db: DB, leadId: string, input: LeadInput) {
  return db.transaction(async (tx) => {
    const before = await lockLead(tx, leadId);
    const { row, deptCodes, serviceIds, tagIds } = await cleanInput(tx, input);
    let sourceId = before.sourceId;
    if (input.sourceId && input.sourceId !== before.sourceId) {
      const [src] = await tx.select({ id: crmSources.id }).from(crmSources).where(eq(crmSources.id, input.sourceId));
      if (!src) throw new UserFacingError("That source could not be found.");
      sourceId = src.id;
    }
    const stages = await stagesInOrder(tx);
    const target = input.stageId ? stages.find((s) => s.id === input.stageId) : undefined;
    if (input.stageId && !target) throw new UserFacingError("That stage no longer exists. Please refresh the page.");
    if (target && target.id !== before.stageId && target.type === "LOST") throw new UserFacingError("To mark it as lost, use “Mark as lost”, so the reason is recorded.");

    const names = new Map((await tx.select({ id: teamMembers.id, name: teamMembers.name }).from(teamMembers)).map((m) => [m.id, m.name]));
    const sourceNames = new Map((await tx.select({ id: crmSources.id, name: crmSources.name }).from(crmSources)).map((m) => [m.id, m.name]));
    const lines: [string, string, Record<string, unknown>][] = [];
    if (row.expectedValue !== before.expectedValue)
      lines.push(["FIELD", `Expected value changed from ${rupees(before.expectedValue)} to ${rupees(row.expectedValue)}`, { field: "expectedValue", from: before.expectedValue, to: row.expectedValue }]);
    if (row.assignedTo !== before.assignedTo) {
      const a = before.assignedTo ? (names.get(before.assignedTo) ?? "someone") : "nobody";
      const b = row.assignedTo ? (names.get(row.assignedTo) ?? "someone") : "nobody";
      lines.push(["FIELD", `Assigned to changed from ${a} to ${b}`, { field: "assignedTo", from: a, to: b }]);
    }
    if (row.priority !== before.priority) lines.push(["FIELD", `Priority changed from ${before.priority} to ${row.priority} ${row.priority === 1 ? "star" : "stars"}`, { field: "priority" }]);
    if (sourceId !== before.sourceId) lines.push(["FIELD", `Source changed from ${sourceNames.get(before.sourceId)} to ${sourceNames.get(sourceId)}`, { field: "source" }]);
    const other = Object.keys(FIELD_LABELS).filter((k) => (row as Record<string, unknown>)[k] !== (before as Record<string, unknown>)[k]);

    const [oldDepts, oldSvcs, oldTags] = await Promise.all([
      tx.select({ v: leadDepartments.deptCode }).from(leadDepartments).where(eq(leadDepartments.leadId, leadId)),
      tx.select({ v: leadServices.serviceId }).from(leadServices).where(eq(leadServices.leadId, leadId)),
      tx.select({ v: leadTags.tagId }).from(leadTags).where(eq(leadTags.leadId, leadId)),
    ]);
    const same = (a: (string | number)[], b: (string | number)[]) => a.length === b.length && a.every((x) => b.includes(x));
    if (!same(oldDepts.map((d) => d.v), deptCodes)) other.push("departments");
    if (!same(oldSvcs.map((d) => d.v), serviceIds)) other.push("services");
    if (!same(oldTags.map((d) => d.v), tagIds)) other.push("tags");
    if (other.length) lines.push(["EDITED", `Details edited: ${other.map((k) => FIELD_LABELS[k] ?? k).join(", ")}`, { fields: other }]);

    await tx.update(leads).set({ ...row, sourceId }).where(eq(leads.id, leadId));
    await tx.delete(leadDepartments).where(eq(leadDepartments.leadId, leadId));
    await tx.delete(leadServices).where(eq(leadServices.leadId, leadId));
    await tx.delete(leadTags).where(eq(leadTags.leadId, leadId));
    if (deptCodes.length) await tx.insert(leadDepartments).values(deptCodes.map((deptCode) => ({ leadId, deptCode })));
    if (serviceIds.length) await tx.insert(leadServices).values(serviceIds.map((serviceId) => ({ leadId, serviceId })));
    if (tagIds.length) await tx.insert(leadTags).values(tagIds.map((tagId) => ({ leadId, tagId })));
    for (const [type, message, data] of lines) await logLeadEvent(tx, leadId, type, message, data);

    let moved: MoveResult | null = null;
    if (target && target.id !== before.stageId) moved = await moveLead(tx, leadId, target.id);
    return { changed: lines.length > 0 || !!moved?.changed, moved };
  });
}

// ---- notes and contact clicks ------------------------------------------------------------

export async function addLeadNote(db: DB, leadId: string, note: string) {
  const text = note.trim();
  if (text.length < 2) throw new UserFacingError("Please write the note first.");
  if (text.length > 3000) throw new UserFacingError("Please keep the note under 3,000 characters.");
  return db.transaction(async (tx) => {
    await lockLead(tx, leadId);
    await logLeadEvent(tx, leadId, "NOTE", text);
  });
}

export const CONTACT_KINDS = { CALL: "Call", WHATSAPP: "WhatsApp", EMAIL: "Email" } as const;
export type ContactKind = keyof typeof CONTACT_KINDS;

export async function logLeadContact(db: DB, leadId: string, kind: ContactKind) {
  return db.transaction(async (tx) => {
    const lead = await lockLead(tx, leadId);
    const to = kind === "EMAIL" ? lead.email : lead.phone ? `+91 ${lead.phone}` : null;
    await logLeadEvent(tx, leadId, `CONTACT_${kind}`, `${CONTACT_KINDS[kind]} opened by ${ACTOR}${to ? ` (${to})` : ""}`, { kind });
  });
}

// ---- duplicate check -----------------------------------------------------------------------

/** "Sahyadri Auto Components Pvt. Ltd." -> "sahyadri auto components" */
export function companyKey(name: string | null | undefined): string {
  return (name ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !["pvt", "private", "ltd", "limited", "llp", "co", "company", "inc", "the", "india", "m", "s"].includes(w))
    .join(" ");
}

export type MatchOn = "mobile" | "email" | "company name";
export interface Duplicates {
  customers: { id: string; companyName: string; matchedOn: MatchOn[] }[];
  leads: { id: string; leadNo: string; title: string; companyName: string; matchedOn: MatchOn[] }[];
}

/**
 * Finds customers and enquiries with the same mobile, email or company name.
 * It never blocks saving; the form only shows a note.
 */
export async function findDuplicates(
  db: DB | Tx,
  q: { phone?: string | null; email?: string | null; companyName?: string | null; excludeLeadId?: string | null; excludeCustomerId?: string | null },
): Promise<Duplicates> {
  const phone = normalizeMobile(q.phone);
  const email = q.email?.trim().toLowerCase() || null;
  const company = companyKey(q.companyName);
  const out: Duplicates = { customers: [], leads: [] };
  if (!phone && !email && company.length < 3) return out;
  const match = (p: string | null, e: string | null, c: string) => {
    const on: MatchOn[] = [];
    if (phone && normalizeMobile(p) === phone) on.push("mobile");
    if (email && e?.trim().toLowerCase() === email) on.push("email");
    if (company.length >= 3 && companyKey(c) === company) on.push("company name");
    return on;
  };
  const custRows = await db
    .select({ id: customers.id, companyName: customers.companyName, phone: customers.pocPhone, email: customers.pocEmail })
    .from(customers)
    .where(isNull(customers.deletedAt));
  for (const c of custRows) {
    if (c.id === q.excludeCustomerId) continue;
    const on = match(c.phone, c.email, c.companyName);
    if (on.length) out.customers.push({ id: c.id, companyName: c.companyName, matchedOn: on });
  }
  const leadRows = await db
    .select({ id: leads.id, leadNo: leads.leadNo, title: leads.title, companyName: leads.companyName, phone: leads.phone, email: leads.email })
    .from(leads)
    .where(isNull(leads.deletedAt))
    .orderBy(desc(leads.createdAt));
  for (const l of leadRows) {
    if (l.id === q.excludeLeadId) continue;
    const on = match(l.phone, l.email, l.companyName);
    if (on.length) out.leads.push({ id: l.id, leadNo: l.leadNo, title: l.title, companyName: l.companyName, matchedOn: on });
  }
  out.leads = out.leads.slice(0, 5);
  out.customers = out.customers.slice(0, 5);
  return out;
}
