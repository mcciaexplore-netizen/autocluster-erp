/** Roles and their permissions (Module 7). */
import { and, eq, inArray, sql } from "drizzle-orm";
import { ADMIN_LOCKED, ALL_PERMISSIONS, DEFAULT_ROLES } from "../lib/auth/permissions";
import { UserFacingError } from "./quote-writer";
import type { DB, Tx } from "./client";
import { rolePermissions, roles, userRoles } from "./schema";

/** Makes sure the default roles exist (never changes ones an Admin has edited). Returns name -> id. */
export async function ensureDefaultRoles(db: DB | Tx): Promise<Record<string, number>> {
  const existing = await db.select().from(roles);
  const ids: Record<string, number> = Object.fromEntries(existing.map((r) => [r.name, r.id]));
  for (const [i, r] of DEFAULT_ROLES.entries()) {
    if (ids[r.name]) continue;
    const [row] = await db.insert(roles).values({ name: r.name, description: r.description, isSystem: true, scopeOwnDepartments: r.scopeOwnDepartments, sortOrder: i + 1 }).returning();
    ids[r.name] = row.id;
    await db.insert(rolePermissions).values(r.permissions.map((permission) => ({ roleId: row.id, permission })));
  }
  return ids;
}

export async function setUserRoles(db: DB | Tx, userId: string, roleIds: number[]) {
  await db.delete(userRoles).where(eq(userRoles.userId, userId));
  const unique = [...new Set(roleIds)];
  if (unique.length) {
    const found = await db.select({ id: roles.id }).from(roles).where(inArray(roles.id, unique));
    await db.insert(userRoles).values(found.map((r) => ({ userId, roleId: r.id })));
  }
}

// ---- Admin: roles (section 5.3) -------------------------------------------------------------------

export interface RoleInput {
  name: string;
  description: string;
  scopeOwnDepartments: boolean;
  permissions: string[];
}

function cleanRole(v: RoleInput) {
  const name = v.name.trim().replace(/\s+/g, " ");
  if (name.length < 2) throw new UserFacingError("Please enter the role's name.");
  if (name.length > 40) throw new UserFacingError("Keep the role's name under 40 characters.");
  const known = new Set<string>(ALL_PERMISSIONS);
  return { name, description: v.description.trim().slice(0, 200), permissions: [...new Set(v.permissions.filter((p) => known.has(p)))] };
}

/** Saves a role. Returns what changed (for the Activity log); applies to everyone's next action. */
export async function saveRole(db: DB, id: number | null, v: RoleInput): Promise<{ id: number; changes: string[] }> {
  const { name, description, permissions } = cleanRole(v);
  return db.transaction(async (tx) => {
    const [clash] = await tx.select({ id: roles.id }).from(roles).where(sql`lower(${roles.name}) = lower(${name})`);
    if (clash && clash.id !== id) throw new UserFacingError(`There is already a role called "${name}".`);
    if (id == null) {
      const [{ max }] = await tx.select({ max: sql<number>`coalesce(max(${roles.sortOrder}), 0)` }).from(roles);
      const [r] = await tx.insert(roles).values({ name, description, scopeOwnDepartments: v.scopeOwnDepartments, sortOrder: Number(max) + 1 }).returning();
      if (permissions.length) await tx.insert(rolePermissions).values(permissions.map((permission) => ({ roleId: r.id, permission })));
      return { id: r.id, changes: ["created"] };
    }
    const [before] = await tx.select().from(roles).where(eq(roles.id, id)).for("update");
    if (!before) throw new UserFacingError("This role could not be found. Please refresh the page.");
    if (before.name === "Admin") {
      if (name !== "Admin") throw new UserFacingError("The Admin role can't be renamed.");
      const missing = ADMIN_LOCKED.filter((p) => !permissions.includes(p));
      if (missing.length) throw new UserFacingError("The Admin role always keeps “Manage users, roles and the activity log” and “Change settings”.");
    }
    const old = (await tx.select().from(rolePermissions).where(eq(rolePermissions.roleId, id))).map((p) => p.permission);
    const added = permissions.filter((p) => !old.includes(p));
    const removed = old.filter((p) => !permissions.includes(p));
    const changes: string[] = [];
    if (name !== before.name) changes.push(`renamed from ${before.name}`);
    if (v.scopeOwnDepartments !== before.scopeOwnDepartments) changes.push(v.scopeOwnDepartments ? "now only their own departments" : "now all departments");
    if (added.length) changes.push(`added ${added.join(", ")}`);
    if (removed.length) changes.push(`removed ${removed.join(", ")}`);
    await tx.update(roles).set({ name, description, scopeOwnDepartments: v.scopeOwnDepartments, updatedAt: new Date() }).where(eq(roles.id, id));
    if (removed.length) await tx.delete(rolePermissions).where(and(eq(rolePermissions.roleId, id), inArray(rolePermissions.permission, removed)));
    if (added.length) await tx.insert(rolePermissions).values(added.map((permission) => ({ roleId: id, permission })));
    return { id, changes };
  });
}

/** "Copy role": the same permissions under a new name. */
export async function copyRole(db: DB, id: number): Promise<{ id: number; name: string }> {
  const [r] = await db.select().from(roles).where(eq(roles.id, id));
  if (!r) throw new UserFacingError("This role could not be found. Please refresh the page.");
  const perms = (await db.select().from(rolePermissions).where(eq(rolePermissions.roleId, id))).map((p) => p.permission);
  const taken = new Set((await db.select({ name: roles.name }).from(roles)).map((x) => x.name.toLowerCase()));
  let name = `${r.name} (copy)`;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${r.name} (copy ${n})`;
  const made = await saveRole(db, null, { name, description: r.description, scopeOwnDepartments: r.scopeOwnDepartments, permissions: perms });
  return { id: made.id, name };
}

/** Delete a role nobody has. */
export async function deleteRole(db: DB, id: number): Promise<string> {
  const [r] = await db.select().from(roles).where(eq(roles.id, id));
  if (!r) throw new UserFacingError("This role could not be found. Please refresh the page.");
  if (r.name === "Admin") throw new UserFacingError("The Admin role can't be deleted.");
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(userRoles).where(eq(userRoles.roleId, id));
  if (n > 0) throw new UserFacingError(`${n} ${n === 1 ? "person has" : "people have"} this role. Give them another role first.`);
  await db.delete(roles).where(eq(roles.id, id));
  return r.name;
}
