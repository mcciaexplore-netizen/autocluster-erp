/**
 * Server side of "Done by": works out whose name goes on the record, and logs
 * "Recorded by X for Y" when a Manager or Admin records work for someone else.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { UserFacingError } from "@/db/quote-writer";
import { appUsers, teamMembers } from "@/db/schema";
import { logActivity, type ActivityArea } from "@/lib/activity";
import { mayRecordForOthers } from "./done-by-rule";
import { signedInUser } from "./guard";

export interface DoneBy {
  /** team_members.id that goes on the record. */
  id: string | null;
  /** Set when it's someone else's work, recorded by the signed-in person. */
  onBehalfOf: { userId: string | null; name: string } | null;
}

/** The person to record: yourself, unless you're a Manager / Admin and chose someone else. */
export async function doneByFor(given: string | null | undefined): Promise<DoneBy> {
  const me = await signedInUser();
  if (!me) return { id: given ?? null, onBehalfOf: null }; // scripts and tests
  if (!given || given === me.teamMemberId || !mayRecordForOthers(me)) return { id: me.teamMemberId, onBehalfOf: null };
  const [m] = await db
    .select({ name: teamMembers.name, active: teamMembers.isActive, userId: appUsers.id })
    .from(teamMembers)
    .leftJoin(appUsers, and(eq(appUsers.teamMemberId, teamMembers.id), isNull(appUsers.deactivatedAt)))
    .where(eq(teamMembers.id, given));
  if (!m || !m.active) throw new UserFacingError("That person can't be chosen any more. Please pick someone else.");
  return { id: given, onBehalfOf: { userId: m.userId, name: m.name } };
}

/** Adds "Recorded by Meera Iyer for Amit Patil: ..." to the Activity log when it applies. */
export async function logOnBehalf(d: DoneBy, area: ActivityArea, what: string, entity?: { type: string; id: string }) {
  if (!d.onBehalfOf) return;
  const me = await signedInUser();
  await logActivity({
    area,
    action: "on behalf",
    summary: `Recorded by ${me?.name ?? "someone"} for ${d.onBehalfOf.name}: ${what}`,
    entityType: entity?.type ?? null,
    entityId: entity?.id ?? null,
    onBehalfOfUserId: d.onBehalfOf.userId,
  });
}
