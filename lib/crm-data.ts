/**
 * Read-only CRM queries used by pages. Every function calls connection()
 * so data is always read fresh at request time.
 */
import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { connection } from "next/server";
import { db } from "@/db";
import { ensureCrmDefaults } from "@/db/crm-defaults";
import {
  crmActivities,
  crmLostReasons,
  crmSources,
  crmStages,
  crmTags,
  leadDepartments,
  leads,
  leadTags,
  teamMembers,
} from "@/db/schema";
import type { ActivityType, FilterableLead } from "@/lib/crm/leads";

/** Stages in board order. Adds the default stages the first time, if there are none. */
export async function getCrmStages() {
  await connection();
  let rows = await db.select().from(crmStages).orderBy(asc(crmStages.sortOrder), asc(crmStages.createdAt));
  if (!rows.length) {
    await ensureCrmDefaults(db);
    rows = await db.select().from(crmStages).orderBy(asc(crmStages.sortOrder), asc(crmStages.createdAt));
  }
  return rows;
}

export type CrmListItem = { id: string; name: string; isActive: boolean; phone?: string | null; email?: string | null };

/** Sources, lost reasons, tags and team members, in their set order (hidden ones included). */
export async function getCrmLists() {
  await connection();
  const [first] = await db.select({ id: crmSources.id }).from(crmSources).limit(1);
  if (!first) await ensureCrmDefaults(db);
  const list = (t: typeof crmSources | typeof crmLostReasons | typeof crmTags) =>
    db.select({ id: t.id, name: t.name, isActive: t.isActive }).from(t).orderBy(asc(t.sortOrder), asc(t.name));
  const [sources, lostReasons, tags, team] = await Promise.all([
    list(crmSources),
    list(crmLostReasons),
    list(crmTags),
    db
      .select({ id: teamMembers.id, name: teamMembers.name, isActive: teamMembers.isActive, phone: teamMembers.phone, email: teamMembers.email })
      .from(teamMembers)
      .orderBy(asc(teamMembers.sortOrder), asc(teamMembers.name)),
  ]);
  return { sources, lostReasons, tags, team };
}
export type CrmLists = Awaited<ReturnType<typeof getCrmLists>>;

export interface BoardLead extends FilterableLead {
  id: string;
  customerId: string | null;
  sourceName: string;
  assignedToName: string | null;
  tags: { id: string; name: string }[];
  nextActivity: { id: string; type: ActivityType; dueDate: string; dueTime: string | null; note: string | null } | null;
  stageChangedAt: string;
  lostReason: string | null;
  lostNote: string | null;
}

/** Every enquiry that isn't deleted, with what the cards and the list need. */
export async function getBoardLeads(): Promise<BoardLead[]> {
  await connection();
  const rows = await db
    .select({
      l: leads,
      sourceName: crmSources.name,
      assignedToName: teamMembers.name,
      lostReason: crmLostReasons.name,
    })
    .from(leads)
    .innerJoin(crmSources, eq(crmSources.id, leads.sourceId))
    .leftJoin(teamMembers, eq(teamMembers.id, leads.assignedTo))
    .leftJoin(crmLostReasons, eq(crmLostReasons.id, leads.lostReasonId))
    .where(isNull(leads.deletedAt));
  if (!rows.length) return [];
  const live = sql`${leads.deletedAt} is null`;
  const [depts, tags, acts] = await Promise.all([
    db.select({ leadId: leadDepartments.leadId, code: leadDepartments.deptCode }).from(leadDepartments).innerJoin(leads, and(eq(leads.id, leadDepartments.leadId), live)),
    db
      .select({ leadId: leadTags.leadId, id: crmTags.id, name: crmTags.name })
      .from(leadTags)
      .innerJoin(crmTags, eq(crmTags.id, leadTags.tagId))
      .innerJoin(leads, and(eq(leads.id, leadTags.leadId), live))
      .orderBy(asc(crmTags.sortOrder)),
    // The next planned activity per enquiry: earliest due date (then time) that isn't done.
    db
      .selectDistinctOn([crmActivities.leadId], {
        leadId: crmActivities.leadId,
        id: crmActivities.id,
        type: crmActivities.type,
        dueDate: crmActivities.dueDate,
        dueTime: crmActivities.dueTime,
        note: crmActivities.note,
      })
      .from(crmActivities)
      .where(isNull(crmActivities.doneAt))
      .orderBy(crmActivities.leadId, asc(crmActivities.dueDate), sql`${crmActivities.dueTime} asc nulls last`, asc(crmActivities.createdAt)),
  ]);
  const group = <T extends { leadId: string }>(list: T[]) => {
    const m = new Map<string, T[]>();
    for (const x of list) m.set(x.leadId, [...(m.get(x.leadId) ?? []), x]);
    return m;
  };
  const deptBy = group(depts);
  const tagBy = group(tags);
  const actBy = new Map(acts.map((a) => [a.leadId, a]));
  return rows.map(({ l, sourceName, assignedToName, lostReason }) => {
    const a = actBy.get(l.id);
    return {
      id: l.id,
      leadNo: l.leadNo,
      title: l.title,
      companyName: l.companyName,
      contactName: l.contactName,
      phone: l.phone,
      email: l.email,
      customerId: l.customerId,
      stageId: l.stageId,
      priority: l.priority,
      expectedValuePaise: l.expectedValue,
      expectedCloseDate: l.expectedCloseDate,
      sourceId: l.sourceId,
      sourceName,
      assignedToId: l.assignedTo,
      assignedToName,
      depts: (deptBy.get(l.id) ?? []).map((d) => d.code),
      tagIds: (tagBy.get(l.id) ?? []).map((t) => t.id),
      tags: (tagBy.get(l.id) ?? []).map((t) => ({ id: t.id, name: t.name })),
      nextActivity: a ? { id: a.id, type: a.type, dueDate: a.dueDate, dueTime: a.dueTime, note: a.note } : null,
      nextActivityDate: a?.dueDate ?? null,
      stageChangedAt: l.stageChangedAt.toISOString(),
      createdAt: l.createdAt.toISOString(),
      lostReason: lostReason ?? null,
      lostNote: l.lostNote,
    };
  });
}

/** What the board's filters, menus and forms choose from (active items only). */
export async function getCrmPickers() {
  const lists = await getCrmLists();
  const active = <T extends { isActive: boolean }>(l: T[]) => l.filter((x) => x.isActive);
  return {
    sources: active(lists.sources).map(({ id, name }) => ({ id, name })),
    lostReasons: active(lists.lostReasons).map(({ id, name }) => ({ id, name })),
    tags: active(lists.tags).map(({ id, name }) => ({ id, name })),
    team: active(lists.team).map(({ id, name }) => ({ id, name })),
  };
}
export type CrmPickers = Awaited<ReturnType<typeof getCrmPickers>>;
export type BoardStage = { id: string; name: string; color: string; type: "OPEN" | "WON" | "LOST"; probability: number; isFolded: boolean };
