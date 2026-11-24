/** Admin pages: Users and Roles (section 5). Everything here needs "users.manage". */
import "server-only";
import { asc, eq, sql } from "drizzle-orm";
import { connection } from "next/server";
import { db } from "@/db";
import { appUsers, departments, rolePermissions, roles, userDepartments, userRoles } from "@/db/schema";
import { need } from "@/lib/auth/guard";
import { lockedEmails } from "@/lib/auth/sign-in-limits";

export type UserStatus = "ACTIVE" | "DEACTIVATED" | "NAME_ONLY" | "LOCKED";
export const USER_STATUS: Record<UserStatus, { label: string; className: string }> = {
  ACTIVE: { label: "Active", className: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  NAME_ONLY: { label: "Name only", className: "border-slate-200 bg-slate-100 text-slate-700" },
  LOCKED: { label: "Locked", className: "border-amber-300 bg-amber-50 text-amber-900" },
  DEACTIVATED: { label: "Deactivated", className: "border-red-200 bg-red-50 text-red-800" },
};

export interface UserFilters {
  q?: string;
  role?: number;
  dept?: string;
  status?: UserStatus;
}

export function userFiltersFromParams(sp: Record<string, string | string[] | undefined>): UserFilters {
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const st = one("status").toUpperCase();
  return {
    q: one("q").trim().slice(0, 80) || undefined,
    role: /^\d+$/.test(one("role")) ? Number(one("role")) : undefined,
    dept: /^[A-Z]{2,6}$/.test(one("dept")) ? one("dept") : undefined,
    status: (["ACTIVE", "DEACTIVATED", "NAME_ONLY", "LOCKED"] as const).find((s) => s === st),
  };
}

export async function listUsers(f: UserFilters = {}) {
  await connection();
  await need(["users.manage"]);
  const [rows, ur, ud, locked] = await Promise.all([
    db.execute<{ id: string; name: string; email: string | null; mobile: string | null; can_sign_in: boolean; all_departments: boolean; deactivated_at: string | null; last_sign_in_at: string | null; is_demo: boolean }>(sql`
      select id, full_name as name, email, mobile, can_sign_in, all_departments, deactivated_at::text, last_sign_in_at::text, is_demo from app_users order by deactivated_at nulls first, full_name`),
    db.select({ userId: userRoles.userId, id: roles.id, name: roles.name }).from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId)).orderBy(asc(roles.sortOrder)),
    db.select().from(userDepartments),
    lockedEmails(db),
  ]);
  const list = rows.rows.map((u) => {
    const status: UserStatus = u.deactivated_at ? "DEACTIVATED" : !u.can_sign_in ? "NAME_ONLY" : u.email && locked.has(u.email) ? "LOCKED" : "ACTIVE";
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      mobile: u.mobile,
      roles: ur.filter((r) => r.userId === u.id).map((r) => ({ id: r.id, name: r.name })),
      allDepartments: u.all_departments,
      departments: ud.filter((d) => d.userId === u.id).map((d) => d.deptCode),
      status,
      lastSignInAt: u.last_sign_in_at,
      isDemo: u.is_demo,
    };
  });
  const q = f.q?.toLowerCase();
  return list.filter(
    (u) =>
      (!q || u.name.toLowerCase().includes(q) || (u.email ?? "").includes(q) || (u.mobile ?? "").includes(q.replace(/\D/g, "") || "~")) &&
      (!f.role || u.roles.some((r) => r.id === f.role)) &&
      (!f.dept || u.allDepartments || u.departments.includes(f.dept)) &&
      (!f.status || u.status === f.status),
  );
}
export type UserRow = Awaited<ReturnType<typeof listUsers>>[number];

/** Roles and departments to choose from on the user form and filters. */
export async function getUserFormOptions() {
  await connection();
  await need(["users.manage"]);
  const [rs, depts] = await Promise.all([
    db.select({ id: roles.id, name: roles.name, description: roles.description }).from(roles).orderBy(asc(roles.sortOrder), asc(roles.name)),
    db.select({ code: departments.code, name: departments.name }).from(departments).orderBy(asc(departments.sortOrder)),
  ]);
  return { roles: rs, departments: depts };
}

export async function getUser(id: string) {
  await connection();
  await need(["users.manage"]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [u] = await db.select().from(appUsers).where(eq(appUsers.id, id));
  if (!u) return null;
  const [rs, ds, history] = await Promise.all([
    db.select({ roleId: userRoles.roleId }).from(userRoles).where(eq(userRoles.userId, id)),
    db.select({ code: userDepartments.deptCode }).from(userDepartments).where(eq(userDepartments.userId, id)),
    db.execute<{ at: string; summary: string; by: string | null }>(sql`
      select a.created_at::text as at, a.summary, b.full_name as by from activity_log a left join app_users b on b.id = a.user_id
      where a.entity_type = 'user' and a.entity_id = ${id} order by a.created_at desc limit 20`),
  ]);
  const locked = u.email ? (await lockedEmails(db)).has(u.email) : false;
  return {
    id: u.id,
    name: u.fullName,
    email: u.email ?? "",
    mobile: u.mobile ?? "",
    canSignIn: u.canSignIn,
    hasAccount: !!u.authUserId,
    mustChangePassword: u.mustChangePassword,
    allDepartments: u.allDepartments,
    deptCodes: ds.map((d) => d.code),
    roleIds: rs.map((r) => r.roleId),
    deactivatedAt: u.deactivatedAt?.toISOString() ?? null,
    lastSignInAt: u.lastSignInAt?.toISOString() ?? null,
    isDemo: u.isDemo,
    locked,
    history: history.rows,
  };
}
export type UserDetail = NonNullable<Awaited<ReturnType<typeof getUser>>>;

/** Roles with how many people have each. */
export async function listRoles() {
  await connection();
  await need(["users.manage"]);
  const r = await db.execute<{ id: number; name: string; description: string; is_system: boolean; scope: boolean; users: string; perms: string }>(sql`
    select r.id, r.name, r.description, r.is_system, r.scope_own_departments as scope,
      (select count(*) from user_roles ur join app_users u on u.id = ur.user_id where ur.role_id = r.id and u.deactivated_at is null) as users,
      (select count(*) from role_permissions p where p.role_id = r.id) as perms
    from roles r order by r.sort_order, r.name`);
  return r.rows.map((x) => ({ id: x.id, name: x.name, description: x.description, isSystem: x.is_system, scopeOwnDepartments: x.scope, users: Number(x.users), permissions: Number(x.perms) }));
}

export async function getRole(id: number) {
  await connection();
  await need(["users.manage"]);
  const [r] = await db.select().from(roles).where(eq(roles.id, id));
  if (!r) return null;
  const [perms, people] = await Promise.all([
    db.select({ p: rolePermissions.permission }).from(rolePermissions).where(eq(rolePermissions.roleId, id)),
    db.execute<{ id: string; name: string }>(sql`select u.id, u.full_name as name from user_roles ur join app_users u on u.id = ur.user_id where ur.role_id = ${id} and u.deactivated_at is null order by u.full_name`),
  ]);
  return { id: r.id, name: r.name, description: r.description, isSystem: r.isSystem, scopeOwnDepartments: r.scopeOwnDepartments, permissions: perms.map((x) => x.p), people: people.rows };
}
export type RoleDetail = NonNullable<Awaited<ReturnType<typeof getRole>>>;
