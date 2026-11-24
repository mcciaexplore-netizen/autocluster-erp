/**
 * Picker lists filtered by role (section 4): "Assigned to" lists people with crm.edit; operator
 * lists list people with planning.operate (with the departments they may work in). Name-only
 * people count too: they can be given roles even though they can't sign in.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { isScoped, type Permission } from "@/lib/auth/permissions";

export interface Person {
  /** team_members.id (what records point to) */
  id: string;
  name: string;
  /** Departments they may do this in; null = all departments. */
  depts: string[] | null;
}

/** Active, not deactivated people whose roles include `perm`. */
export async function peopleWith(perm: Permission): Promise<Person[]> {
  const r = await db.execute<{ id: string; name: string; everywhere: boolean; depts: string[] | null }>(sql`
    select tm.id, tm.name,
      (u.all_departments or bool_or(not r.scope_own_departments)) as everywhere,
      (select array_agg(ud.dept_code order by ud.dept_code) from user_departments ud where ud.user_id = u.id) as depts
    from team_members tm
    join app_users u on u.team_member_id = tm.id and u.deactivated_at is null
    join user_roles ur on ur.user_id = u.id
    join roles r on r.id = ur.role_id
    join role_permissions rp on rp.role_id = r.id and rp.permission = ${perm}
    where tm.is_active
    group by tm.id, tm.name, tm.sort_order, u.id, u.all_departments
    order by tm.sort_order, tm.name`);
  const scoped = isScoped(perm);
  return r.rows.map((x) => ({ id: x.id, name: x.name, depts: !scoped || x.everywhere ? null : (x.depts ?? []) }));
}

/** Keeps a list's current choice visible even if that person no longer qualifies. */
export function withCurrent<T extends { id: string; name: string }>(list: T[], current: { id: string | null; name: string | null } | null | undefined, extra: Omit<T, "id" | "name">): T[] {
  if (!current?.id || !current.name || list.some((p) => p.id === current.id)) return list;
  return [...list, { ...extra, id: current.id, name: current.name } as T];
}
