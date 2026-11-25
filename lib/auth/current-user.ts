/**
 * The signed-in person, read once per request (React cache). The Data Access Layer for sign-in:
 * every action, route and loader goes through here, never through the cookie alone.
 */
import "server-only";
import { cookies, headers } from "next/headers";
import { connection } from "next/server";
import { cache } from "react";
import { db } from "@/db";
import { setActorResolver } from "./actor";
import "@/lib/activity"; // registers the Activity log hook
import { readAccess, readFloorAccess } from "./access";
import { DEVICE_COOKIE, findDevice, FLOOR_COOKIE, floorGrants, verifyFloor } from "./floor-core";
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
  /** Set for a PIN session on a shared shop-floor device: Today's work only. */
  floor?: { deviceId: string; deviceName: string; expires: number };
}

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const s = await auth.api.getSession({ headers: await headers() });
  if (!s) return floorUser();
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

/** A PIN session on a shared device: a signed, short-lived cookie, and the device must still be shared. */
async function floorUser(): Promise<CurrentUser | null> {
  // Request data first, then the clock (Cache Components: never read the time while prerendering).
  await connection();
  const jar = await cookies();
  const session = verifyFloor(jar.get(FLOOR_COOKIE)?.value, process.env.AUTH_SECRET, Date.now());
  if (!session) return null;
  const device = await findDevice(db, jar.get(DEVICE_COOKIE)?.value);
  if (!device || device.id !== session.d) return null;
  const a = await readFloorAccess(db, session.u);
  if (!a) return null;
  const { user: u } = a;
  return {
    id: u.id,
    authUserId: u.authUserId ?? "",
    sessionId: `floor:${device.id}`,
    name: u.fullName,
    email: u.email ?? "",
    mobile: u.mobile,
    teamMemberId: u.teamMemberId,
    mustChangePassword: false,
    isDemo: u.isDemo,
    allDepartments: u.allDepartments,
    departments: a.departments,
    roles: a.roles,
    grants: floorGrants(a.grants),
    floor: { deviceId: device.id, deviceName: device.name, expires: session.exp },
  };
}

setActorResolver(async () => {
  const u = await getCurrentUser();
  return u ? { userId: u.id, name: u.name, teamMemberId: u.teamMemberId } : null;
});
