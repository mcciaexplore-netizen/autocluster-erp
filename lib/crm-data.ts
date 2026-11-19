/**
 * Read-only CRM queries used by pages. Every function calls connection()
 * so data is always read fresh at request time.
 */
import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { connection } from "next/server";
import { db } from "@/db";
import { ensureCrmDefaults } from "@/db/crm-defaults";
import {
  crmActivities,
  crmLostReasons,
  crmSources,
  crmStages,
  crmTags,
  customers,
  departments as departmentsTable,
  leadDepartments,
  leadEvents,
  leads,
  leadServices,
  leadTags,
  quotations,
  services,
  settings,
  teamMembers,
  tickets,
} from "@/db/schema";
import { leadContactLinks, type LeadContactLinks } from "@/lib/crm/contact-links";
import { toPaise } from "@/lib/pricing";
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

/** Everything the enquiry panel and full page show. */
export async function getLeadDetail(id: string) {
  await connection();
  const [row] = await db
    .select({ l: leads, sourceName: crmSources.name, assignedToName: teamMembers.name, lostReason: crmLostReasons.name })
    .from(leads)
    .innerJoin(crmSources, eq(crmSources.id, leads.sourceId))
    .leftJoin(teamMembers, eq(teamMembers.id, leads.assignedTo))
    .leftJoin(crmLostReasons, eq(crmLostReasons.id, leads.lostReasonId))
    .where(and(eq(leads.id, id), isNull(leads.deletedAt)));
  if (!row) return null;
  const l = row.l;
  const [depts, svcs, tags, acts, events, quotes, customer, set] = await Promise.all([
    db.select({ code: leadDepartments.deptCode }).from(leadDepartments).where(eq(leadDepartments.leadId, id)),
    db
      .select({ id: services.id, name: services.name, deptCode: services.deptCode })
      .from(leadServices)
      .innerJoin(services, eq(services.id, leadServices.serviceId))
      .where(eq(leadServices.leadId, id))
      .orderBy(asc(services.sortOrder)),
    db.select({ id: crmTags.id, name: crmTags.name }).from(leadTags).innerJoin(crmTags, eq(crmTags.id, leadTags.tagId)).where(eq(leadTags.leadId, id)).orderBy(asc(crmTags.sortOrder)),
    db
      .select({ a: crmActivities, assignedToName: teamMembers.name })
      .from(crmActivities)
      .leftJoin(teamMembers, eq(teamMembers.id, crmActivities.assignedTo))
      .where(eq(crmActivities.leadId, id))
      .orderBy(asc(crmActivities.dueDate), sql`${crmActivities.dueTime} asc nulls last`, asc(crmActivities.createdAt)),
    db.select().from(leadEvents).where(eq(leadEvents.leadId, id)).orderBy(desc(leadEvents.createdAt), desc(leadEvents.id)),
    db
      .select({ id: quotations.id, quoteNo: quotations.quoteNo, status: quotations.status, grandTotal: quotations.grandTotal, quoteDate: quotations.quoteDate })
      .from(quotations)
      .where(and(eq(quotations.leadId, id), isNull(quotations.deletedAt)))
      .orderBy(desc(quotations.createdAt)),
    l.customerId ? db.select({ id: customers.id, companyName: customers.companyName, deletedAt: customers.deletedAt }).from(customers).where(eq(customers.id, l.customerId)) : Promise.resolve([]),
    db.select().from(settings).where(eq(settings.id, 1)),
  ]);
  const quoteIds = quotes.map((q) => q.id);
  const tix = quoteIds.length
    ? await db.select({ quotationId: tickets.quotationId, ticketNo: tickets.ticketNo, stage: tickets.stage, description: sql<string>`${tickets.snapshot}->>'description'` }).from(tickets).where(inArray(tickets.quotationId, quoteIds)).orderBy(asc(tickets.seq))
    : [];
  const s = set[0];
  const contact: LeadContactLinks = leadContactLinks(
    { contactName: l.contactName, companyName: l.companyName, title: l.title, phone: l.phone, email: l.email },
    { whatsapp: s?.leadWhatsappTemplate ?? "", emailSubject: s?.leadEmailSubjectTemplate ?? "", emailBody: s?.leadEmailBodyTemplate ?? "" },
  );
  const c = customer[0];
  return {
    lead: {
      id: l.id,
      leadNo: l.leadNo,
      title: l.title,
      customerId: l.customerId,
      companyName: l.companyName,
      contactName: l.contactName,
      designation: l.designation,
      phone: l.phone,
      email: l.email,
      city: l.city,
      category: l.category,
      isMcciaMember: l.isMcciaMember,
      mcciaMembershipId: l.mcciaMembershipId,
      sourceId: l.sourceId,
      sourceName: row.sourceName,
      stageId: l.stageId,
      priority: l.priority,
      expectedValuePaise: l.expectedValue,
      expectedCloseDate: l.expectedCloseDate,
      assignedTo: l.assignedTo,
      assignedToName: row.assignedToName,
      notes: l.notes,
      lostReason: row.lostReason,
      lostNote: l.lostNote,
      wonAt: l.wonAt?.toISOString() ?? null,
      lostAt: l.lostAt?.toISOString() ?? null,
      stageChangedAt: l.stageChangedAt.toISOString(),
      createdAt: l.createdAt.toISOString(),
    },
    deptCodes: depts.map((d) => d.code),
    services: svcs,
    tags,
    activities: acts.map(({ a, assignedToName }) => ({
      id: a.id,
      type: a.type,
      dueDate: a.dueDate,
      dueTime: a.dueTime,
      note: a.note,
      assignedTo: a.assignedTo,
      assignedToName,
      doneAt: a.doneAt?.toISOString() ?? null,
      outcome: a.outcome,
    })),
    events: events.map((e) => ({ id: e.id, type: e.type, message: e.message, createdBy: e.createdBy, createdAt: e.createdAt.toISOString() })),
    customer: c && !c.deletedAt ? { id: c.id, companyName: c.companyName } : null,
    quotations: quotes.map((q) => ({
      id: q.id,
      quoteNo: q.quoteNo,
      status: q.status,
      totalPaise: toPaise(q.grandTotal),
      quoteDate: q.quoteDate,
      tickets: tix.filter((t) => t.quotationId === q.id).map((t) => ({ ticketNo: t.ticketNo, stage: t.stage, description: t.description })),
    })),
    contact,
  };
}
export type LeadDetail = NonNullable<Awaited<ReturnType<typeof getLeadDetail>>>;

/** What the enquiry form chooses from. */
export async function getLeadFormOptions() {
  const [pickers, stages, depts, svcs, custs] = await Promise.all([
    getCrmPickers(),
    getCrmStages(),
    db.select().from(departmentsTable).orderBy(asc(departmentsTable.sortOrder)),
    db.select({ id: services.id, name: services.name, deptCode: services.deptCode }).from(services).where(eq(services.isActive, true)).orderBy(asc(services.sortOrder)),
    db
      .select({
        id: customers.id,
        companyName: customers.companyName,
        pocName: customers.pocName,
        pocDesignation: customers.pocDesignation,
        pocPhone: customers.pocPhone,
        pocEmail: customers.pocEmail,
        gstin: customers.gstin,
        city: customers.city,
        category: customers.category,
        isMcciaMember: customers.isMcciaMember,
        mcciaMembershipId: customers.mcciaMembershipId,
      })
      .from(customers)
      .where(and(isNull(customers.deletedAt), eq(customers.status, "ACTIVE")))
      .orderBy(asc(customers.companyName)),
  ]);
  return {
    ...pickers,
    stages: stages.map((s) => ({ id: s.id, name: s.name, color: s.color, type: s.type })),
    departments: depts.map((d) => ({ code: d.code, name: d.name })),
    services: svcs,
    customers: custs,
  };
}
export type LeadFormOptions = Awaited<ReturnType<typeof getLeadFormOptions>>;
