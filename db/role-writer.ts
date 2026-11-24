/** Roles and their permissions (Module 7). */
import { eq, inArray } from "drizzle-orm";
import { DEFAULT_ROLES } from "../lib/auth/permissions";
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
