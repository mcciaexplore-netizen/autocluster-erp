/**
 * CRM activities (Odoo-style scheduled activities): plan, mark done, cancel.
 * Every step is written to the enquiry's history. Kept free of Next.js imports.
 */
import { and, eq, isNull } from "drizzle-orm";
import { ACTIVITY_TYPES, type ActivityType } from "@/lib/crm/leads";
import { timeLabel } from "@/lib/crm/time";
import { formatDate } from "@/lib/format";
import { todayInIndia } from "@/lib/tickets";
import type { DB, Tx } from "./client";
import { ACTOR, logLeadEvent } from "./lead-writer";
import { UserFacingError } from "./quote-writer";
import { crmActivities, leads, teamMembers } from "./schema";

export interface PlanInput {
  leadId: string;
  type: ActivityType;
  dueDate: string;
  dueTime?: string | null;
  note?: string | null;
  assignedTo?: string | null;
}

export { timeLabel };

async function liveLead(tx: Tx, leadId: string) {
  const [lead] = await tx.select().from(leads).where(and(eq(leads.id, leadId), isNull(leads.deletedAt))).for("update");
  if (!lead) throw new UserFacingError("This enquiry could not be found. It may have been deleted.");
  return lead;
}

async function memberName(tx: Tx, id: string | null) {
  if (!id) return null;
  const [m] = await tx.select({ name: teamMembers.name }).from(teamMembers).where(eq(teamMembers.id, id));
  if (!m) throw new UserFacingError("That team member could not be found.");
  return m.name;
}

/** Plans an activity. Assigned to the enquiry's owner unless someone else is chosen. */
export async function planActivity(db: DB | Tx, input: PlanInput, today: string = todayInIndia()) {
  if (!(input.type in ACTIVITY_TYPES)) throw new UserFacingError("Please choose the type of activity.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate ?? "")) throw new UserFacingError("Please choose the due date.");
  if (input.dueDate < today) throw new UserFacingError("The due date can't be in the past. Please choose today or a later date.");
  const time = input.dueTime?.trim() || null;
  if (time && !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(time)) throw new UserFacingError("The time doesn't look right, e.g. 10:30.");
  const note = input.note?.trim() || null;
  if (note && note.length > 1000) throw new UserFacingError("Please keep the note under 1,000 characters.");
  return db.transaction(async (tx) => {
    const lead = await liveLead(tx, input.leadId);
    const assignedTo = input.assignedTo === undefined ? lead.assignedTo : input.assignedTo || null;
    const who = await memberName(tx, assignedTo);
    const [a] = await tx
      .insert(crmActivities)
      .values({ leadId: lead.id, type: input.type, dueDate: input.dueDate, dueTime: time, note, assignedTo })
      .returning();
    const when = `${formatDate(input.dueDate)}${time ? ` at ${timeLabel(time)}` : ""}`;
    await logLeadEvent(tx, lead.id, "ACTIVITY_PLANNED", `${ACTIVITY_TYPES[input.type]} planned for ${when}${who ? ` (${who})` : ""}${note ? `: ${note}` : ""}`, {
      activityId: a.id,
    });
    return a;
  });
}

async function openActivity(tx: Tx, activityId: string) {
  const [a] = await tx.select().from(crmActivities).where(eq(crmActivities.id, activityId)).for("update");
  if (!a) throw new UserFacingError("This activity could not be found. Please refresh the page.");
  if (a.doneAt) throw new UserFacingError("This activity is already marked as done.");
  await liveLead(tx, a.leadId);
  return a;
}

/** Marks a planned activity as done, with a short outcome note. It then appears in the history. */
export async function markActivityDone(db: DB | Tx, activityId: string, outcome: string) {
  const text = outcome.trim();
  if (text.length < 2) throw new UserFacingError("Please write a short outcome, e.g. “Spoke to Neha, sending drawings Monday”.");
  if (text.length > 1000) throw new UserFacingError("Please keep the outcome under 1,000 characters.");
  return db.transaction(async (tx) => {
    const a = await openActivity(tx, activityId);
    await tx.update(crmActivities).set({ doneAt: new Date(), outcome: text }).where(eq(crmActivities.id, a.id));
    await logLeadEvent(tx, a.leadId, "ACTIVITY_DONE", `${ACTIVITY_TYPES[a.type]} done by ${ACTOR}: ${text}`, { activityId: a.id, planned: a.dueDate });
    return { leadId: a.leadId, assignedTo: a.assignedTo, type: a.type };
  });
}

/** Removes a planned activity that isn't needed any more (logged). */
export async function cancelActivity(db: DB | Tx, activityId: string) {
  return db.transaction(async (tx) => {
    const a = await openActivity(tx, activityId);
    await tx.delete(crmActivities).where(eq(crmActivities.id, a.id));
    await logLeadEvent(tx, a.leadId, "ACTIVITY_CANCELLED", `${ACTIVITY_TYPES[a.type]} planned for ${formatDate(a.dueDate)} was cancelled`, { activityId: a.id });
  });
}
