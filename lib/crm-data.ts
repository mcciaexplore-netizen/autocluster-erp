/**
 * Read-only CRM queries used by pages. Every function calls connection()
 * so data is always read fresh at request time.
 */
import "server-only";
import { asc } from "drizzle-orm";
import { connection } from "next/server";
import { db } from "@/db";
import { ensureCrmDefaults } from "@/db/crm-defaults";
import { crmLostReasons, crmSources, crmStages, crmTags, teamMembers } from "@/db/schema";

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
