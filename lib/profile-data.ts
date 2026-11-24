/** The profile page: the signed-in person, their devices, roles and departments. */
import "server-only";
import { and, asc, desc, eq, gt } from "drizzle-orm";
import { need } from "@/lib/auth/guard";
import { connection } from "next/server";
import { db } from "@/db";
import { authSessions, departments } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/current-user";

export async function getProfile() {
  await connection();
  await need();
  const me = await getCurrentUser();
  if (!me) return null;
  const [sessions, depts] = await Promise.all([
    db
      .select({ id: authSessions.id, createdAt: authSessions.createdAt, updatedAt: authSessions.updatedAt, ip: authSessions.ipAddress, userAgent: authSessions.userAgent })
      .from(authSessions)
      .where(and(eq(authSessions.userId, me.authUserId), gt(authSessions.expiresAt, new Date())))
      .orderBy(desc(authSessions.updatedAt)),
    db.select({ code: departments.code, name: departments.name }).from(departments).orderBy(asc(departments.sortOrder)),
  ]);
  return {
    me,
    sessions: sessions.map((s) => ({ ...s, current: s.id === me.sessionId })),
    departments: me.allDepartments ? [] : depts.filter((d) => me.departments.includes(d.code)),
  };
}
export type Profile = NonNullable<Awaited<ReturnType<typeof getProfile>>>;
