/**
 * Editing the lists in Settings: CRM (enquiry sources, lost reasons, tags, team members)
 * and Inventory (categories, units, internal use purposes, adjustment reasons).
 * Items in use are hidden instead of deleted, so old enquiries keep their values.
 */
import { and, asc, eq, ne, sql } from "drizzle-orm";
import type { DB, Tx } from "./client";
import { UserFacingError } from "./quote-writer";
import {
  crmActivities,
  crmLostReasons,
  crmSources,
  crmTags,
  invAdjustReasons,
  invCategories,
  invDocuments,
  invItems,
  invMovements,
  invPurposes,
  invUnits,
  leads,
  leadTags,
  teamMembers,
} from "./schema";

export const CRM_LISTS = {
  sources: { table: crmSources, label: "source" },
  lostReasons: { table: crmLostReasons, label: "lost reason" },
  tags: { table: crmTags, label: "tag" },
  team: { table: teamMembers, label: "team member" },
  // Inventory (Settings > Inventory)
  invCategories: { table: invCategories, label: "category" },
  invUnits: { table: invUnits, label: "unit" },
  invPurposes: { table: invPurposes, label: "purpose" },
  invReasons: { table: invAdjustReasons, label: "reason" },
} as const;
export type CrmListKey = keyof typeof CRM_LISTS;

export type ListItemInput = { name: string; phone?: string | null; email?: string | null };

function cleanName(name: string, label: string) {
  const n = name.trim().replace(/\s+/g, " ");
  if (!n) throw new UserFacingError(`Please enter a name for the ${label}.`);
  if (n.length > 60) throw new UserFacingError("Please keep the name under 60 characters.");
  return n;
}

function teamExtras(key: CrmListKey, input: ListItemInput) {
  if (key !== "team") return {};
  const phone = input.phone?.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "") || null;
  if (phone && !/^[6-9]\d{9}$/.test(phone)) throw new UserFacingError("The mobile number should have 10 digits, e.g. 98220 12345.");
  const email = input.email?.trim() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new UserFacingError("This email address doesn't look right, e.g. name@company.com.");
  return { phone, email };
}

async function nameTaken(db: DB | Tx, key: CrmListKey, name: string, exceptId?: string) {
  const t = CRM_LISTS[key].table;
  const where = exceptId ? and(sql`lower(${t.name}) = lower(${name})`, ne(t.id, exceptId)) : sql`lower(${t.name}) = lower(${name})`;
  return (await db.select({ id: t.id }).from(t).where(where)).length > 0;
}

export async function addListItem(db: DB, key: CrmListKey, input: ListItemInput) {
  const { table, label } = CRM_LISTS[key];
  const name = cleanName(input.name, label);
  if (await nameTaken(db, key, name)) throw new UserFacingError(`"${name}" is already in the list.`);
  const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${table.sortOrder}), 0)` }).from(table);
  const [row] = await db
    .insert(table)
    .values({ name, sortOrder: Number(max) + 1, ...teamExtras(key, input) })
    .returning({ id: table.id });
  return row.id;
}

export async function updateListItem(db: DB, key: CrmListKey, id: string, input: ListItemInput) {
  const { table, label } = CRM_LISTS[key];
  const name = cleanName(input.name, label);
  if (await nameTaken(db, key, name, id)) throw new UserFacingError(`"${name}" is already in the list.`);
  const r = await db.update(table).set({ name, ...teamExtras(key, input) }).where(eq(table.id, id)).returning({ id: table.id });
  if (!r.length) throw new UserFacingError("This item could not be found. Please refresh the page.");
}

export async function setListItemActive(db: DB, key: CrmListKey, id: string, isActive: boolean) {
  const { table } = CRM_LISTS[key];
  await db.update(table).set({ isActive }).where(eq(table.id, id));
}

/** Moves an item one place up or down. */
export async function moveListItem(db: DB, key: CrmListKey, id: string, dir: -1 | 1) {
  const { table } = CRM_LISTS[key];
  await db.transaction(async (tx) => {
    const rows = await tx.select({ id: table.id }).from(table).orderBy(asc(table.sortOrder), asc(table.name)).for("update");
    const i = rows.findIndex((r) => r.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= rows.length) return;
    [rows[i], rows[j]] = [rows[j], rows[i]];
    for (const [n, r] of rows.entries()) await tx.update(table).set({ sortOrder: n + 1 }).where(eq(table.id, r.id));
  });
}

/** How many enquiries (or activities) use an item. */
export async function listItemUses(db: DB | Tx, key: CrmListKey, id: string): Promise<number> {
  const n = async (q: Promise<{ n: number }[]>) => Number((await q)[0]?.n ?? 0);
  const c = sql<number>`count(*)`;
  switch (key) {
    case "sources":
      return n(db.select({ n: c }).from(leads).where(eq(leads.sourceId, id)));
    case "lostReasons":
      return n(db.select({ n: c }).from(leads).where(eq(leads.lostReasonId, id)));
    case "tags":
      return n(db.select({ n: c }).from(leadTags).where(eq(leadTags.tagId, id)));
    case "team":
      return (
        (await n(db.select({ n: c }).from(leads).where(eq(leads.assignedTo, id)))) +
        (await n(db.select({ n: c }).from(crmActivities).where(eq(crmActivities.assignedTo, id)))) +
        (await n(db.select({ n: c }).from(invDocuments).where(eq(invDocuments.doneBy, id))))
      );
    case "invCategories":
      return n(db.select({ n: c }).from(invItems).where(eq(invItems.categoryId, id)));
    case "invUnits":
      return n(db.select({ n: c }).from(invItems).where(eq(invItems.unitId, id)));
    case "invPurposes":
      return n(db.select({ n: c }).from(invDocuments).where(eq(invDocuments.purposeId, id)));
    case "invReasons":
      return n(db.select({ n: c }).from(invMovements).where(eq(invMovements.reasonId, id)));
  }
}

/** Deletes an unused item. An item in use is hidden instead. */
export async function deleteListItem(db: DB, key: CrmListKey, id: string): Promise<"deleted" | "hidden"> {
  const { table } = CRM_LISTS[key];
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(4242002)`);
    if ((await listItemUses(tx, key, id)) > 0) {
      await tx.update(table).set({ isActive: false }).where(eq(table.id, id));
      return "hidden" as const;
    }
    try {
      // A savepoint, so if someone used it a moment ago the delete is refused and we hide it instead.
      await tx.transaction((sp) => sp.delete(table).where(eq(table.id, id)));
      return "deleted" as const;
    } catch (e) {
      if ((e as { cause?: { code?: string }; code?: string }).cause?.code !== "23503" && (e as { code?: string }).code !== "23503") throw e;
      await tx.update(table).set({ isActive: false }).where(eq(table.id, id));
      return "hidden" as const;
    }
  });
}
