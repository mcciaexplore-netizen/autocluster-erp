/**
 * What a signed-in account may do, read fresh from the database (no caching between requests,
 * so a role change or a deactivation applies on the person's very next click).
 */
import { eq } from "drizzle-orm";
import type { DB, Tx } from "@/db/client";
import { appUsers, rolePermissions, roles, userDepartments, userRoles } from "@/db/schema";
import { buildGrants, type Grants } from "./can";
import { isDemoMode } from "./demo-mode";

export interface Access {
  user: typeof appUsers.$inferSelect;
  departments: string[];
  roles: { id: number; name: string }[];
  grants: Grants;
}

/** null when there's no such person, or they're deactivated or name only. */
export async function readAccess(conn: DB | Tx, authUserId: string): Promise<Access | null> {
  const [u] = await conn.select().from(appUsers).where(eq(appUsers.authUserId, authUserId));
  if (!u || u.deactivatedAt || !u.canSignIn) return null;
  if (u.isDemo && !isDemoMode()) return null; // demo accounts work only on the demo site
  return accessFor(conn, u);
}

/**
 * A shop-floor PIN session (section 7): the person by their app_users id. Name-only people may
 * use a PIN on a shared device; deactivated people and people without a PIN may not.
 */
export async function readFloorAccess(conn: DB | Tx, appUserId: string): Promise<Access | null> {
  const [u] = await conn.select().from(appUsers).where(eq(appUsers.id, appUserId));
  if (!u || u.deactivatedAt || !u.pinHash) return null;
  if (u.isDemo && !isDemoMode()) return null;
  return accessFor(conn, u);
}

async function accessFor(conn: DB | Tx, u: typeof appUsers.$inferSelect): Promise<Access> {
  const [depts, rs, perms] = await Promise.all([
    conn.select({ code: userDepartments.deptCode }).from(userDepartments).where(eq(userDepartments.userId, u.id)),
    conn.select({ id: roles.id, name: roles.name, scope: roles.scopeOwnDepartments }).from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId)).where(eq(userRoles.userId, u.id)).orderBy(roles.sortOrder),
    conn.select({ roleId: rolePermissions.roleId, permission: rolePermissions.permission }).from(rolePermissions).innerJoin(userRoles, eq(userRoles.roleId, rolePermissions.roleId)).where(eq(userRoles.userId, u.id)),
  ]);
  const departments = depts.map((d) => d.code);
  const grants = buildGrants(
    rs.map((r) => ({ scopeOwnDepartments: r.scope, permissions: perms.filter((p) => p.roleId === r.id).map((p) => p.permission) })),
    { allDepartments: u.allDepartments, departments },
  );
  return { user: u, departments, roles: rs.map((r) => ({ id: r.id, name: r.name })), grants };
}
