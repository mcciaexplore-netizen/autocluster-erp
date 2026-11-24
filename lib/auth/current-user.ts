/**
 * The signed-in person, read once per request (React cache). The Data Access Layer for sign-in:
 * every action, route and loader goes through here, never through the cookie alone.
 */
import "server-only";
import { headers } from "next/headers";
import { cache } from "react";
import { db } from "@/db";
import { setActorResolver } from "./actor";
import { readAccess } from "./access";
import type { Grants } from "./can";
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
  /** What they may do (from their roles, read fresh on every request so role changes apply at once). */
  grants: Grants;
}

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const s = await auth.api.getSession({ headers: await headers() });
  if (!s) return null;
  const a = await readAccess(db, s.user.id);
  // Deactivated or switched to "name only": no access, even with a session left over.
  if (!a) return null;
  const { user: u, departments, grants } = a;
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
    departments,
    roles: a.roles,
    grants,
  };
});

setActorResolver(async () => {
  const u = await getCurrentUser();
  return u ? { userId: u.id, name: u.name, teamMemberId: u.teamMemberId } : null;
});
