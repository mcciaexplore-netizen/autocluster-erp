/** The profile page: the signed-in person, their devices, roles and departments. */
import "server-only";
import { and, asc, desc, eq, gt, inArray } from "drizzle-orm";
import { need } from "@/lib/auth/guard";
import { connection } from "next/server";
import { db } from "@/db";
import { activityLog, appUsers, authSessions, departments } from "@/db/schema";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { can } from "@/lib/auth/can";
import { DEVICE_COOKIE, findDevice } from "@/lib/auth/floor-core";
import { getCurrentUser } from "@/lib/auth/current-user";

export async function getProfile() {
  await connection();
  await need();
  const me = await getCurrentUser();
  if (!me) return null;
  if (me.floor) redirect("/floor"); // a shop-floor PIN session has no profile
  const [sessions, depts, signIns, [pin], device] = await Promise.all([
    db
      .select({ id: authSessions.id, createdAt: authSessions.createdAt, updatedAt: authSessions.updatedAt, ip: authSessions.ipAddress, userAgent: authSessions.userAgent })
      .from(authSessions)
      .where(and(eq(authSessions.userId, me.authUserId), gt(authSessions.expiresAt, new Date())))
      .orderBy(desc(authSessions.updatedAt)),
    db.select({ code: departments.code, name: departments.name }).from(departments).orderBy(asc(departments.sortOrder)),
    // Sign-in history: their last 10 sign-ins and failed tries.
    db
      .select({ at: activityLog.createdAt, action: activityLog.action, ip: activityLog.ip, userAgent: activityLog.userAgent })
      .from(activityLog)
      .where(and(eq(activityLog.area, "Sign-in"), eq(activityLog.entityType, "user"), eq(activityLog.entityId, me.id), inArray(activityLog.action, ["signed in", "failed sign-in"])))
      .orderBy(desc(activityLog.createdAt))
      .limit(10),
    db.select({ has: appUsers.pinHash }).from(appUsers).where(eq(appUsers.id, me.id)),
    findDevice(db, (await cookies()).get(DEVICE_COOKIE)?.value),
  ]);
  return {
    me,
    sessions: sessions.map((s) => ({ ...s, current: s.id === me.sessionId })),
    signIns: signIns.map((x) => ({ at: x.at.toISOString(), ok: x.action === "signed in", ip: x.ip, userAgent: x.userAgent })),
    departments: me.allDepartments ? [] : depts.filter((d) => me.departments.includes(d.code)),
    allDepartments: depts,
    pin: { canOperate: can(me, "planning.operate"), hasPin: !!pin?.has },
    /** Admins: is this browser a shared shop-floor device? */
    device: can(me, "users.manage") ? { current: device ? { name: device.name, deptCodes: device.deptCodes } : null } : null,
  };
}
export type Profile = NonNullable<Awaited<ReturnType<typeof getProfile>>>;
