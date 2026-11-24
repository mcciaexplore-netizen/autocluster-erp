/**
 * The signed-in person, read once per request (React cache). The Data Access Layer for sign-in:
 * every action, route and loader goes through here, never through the cookie alone.
 */
import "server-only";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { cache } from "react";
import { db } from "@/db";
import { appUsers, roles, userDepartments, userRoles } from "@/db/schema";
import { setActorResolver } from "./actor";
import { auth } from "./server";

export interface CurrentUser {
  /** app_users.id */
  id: string;
  authUserId: string;
  sessionId: string;
  name: string;
  email: string;
  mobile: string | null;
  teamMemberId: string;
  mustChangePassword: boolean;
  isDemo: boolean;
  allDepartments: boolean;
  departments: string[];
  roles: { id: number; name: string }[];
}

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const s = await auth.api.getSession({ headers: await headers() });
  if (!s) return null;
  const [u] = await db.select().from(appUsers).where(eq(appUsers.authUserId, s.user.id));
  // Deactivated or switched to "name only": no access, even with a session left over.
  if (!u || u.deactivatedAt || !u.canSignIn) return null;
  const [depts, rs] = await Promise.all([
    db.select({ code: userDepartments.deptCode }).from(userDepartments).where(eq(userDepartments.userId, u.id)),
    db.select({ id: roles.id, name: roles.name }).from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId)).where(eq(userRoles.userId, u.id)),
  ]);
  return {
    id: u.id,
    authUserId: s.user.id,
    sessionId: s.session.id,
    name: u.fullName,
    email: u.email ?? s.user.email,
    mobile: u.mobile,
    teamMemberId: u.teamMemberId,
    mustChangePassword: u.mustChangePassword,
    isDemo: u.isDemo,
    allDepartments: u.allDepartments,
    departments: depts.map((d) => d.code),
    roles: rs,
  };
});

setActorResolver(async () => {
  const u = await getCurrentUser();
  return u ? { userId: u.id, name: u.name, teamMemberId: u.teamMemberId } : null;
});
