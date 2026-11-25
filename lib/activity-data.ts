/** The Activity log page (section 5.4). Everything here needs "users.manage". */
import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { connection } from "next/server";
import { db } from "@/db";
import { moneyView, need } from "@/lib/auth/guard";
import { hideRupees } from "@/lib/money-text";

export const ACTIVITY_AREAS = ["Sign-in", "Users", "Roles", "Settings", "CRM", "Customers", "Quotations", "Orders", "Planning", "Inventory", "Rate Card"] as const;

export interface ActivityFilters {
  user?: string;
  area?: string;
  from?: string;
  to?: string;
  limit?: number;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function activityFiltersFromParams(sp: Record<string, string | string[] | undefined>): ActivityFilters {
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const limit = Number(one("limit"));
  return {
    user: UUID.test(one("user")) ? one("user") : undefined,
    area: (ACTIVITY_AREAS as readonly string[]).find((a) => a.toLowerCase() === one("area").toLowerCase()),
    from: DATE.test(one("from")) ? one("from") : undefined,
    to: DATE.test(one("to")) ? one("to") : undefined,
    limit: Number.isInteger(limit) && limit > 0 ? Math.min(limit, 5000) : undefined,
  };
}

/** Where a record lives in the app, and its number or name, for the "Record" column. */
const RECORD_SQL = sql`
  case a.entity_type
    when 'lead' then (select l.lead_no from leads l where l.id::text = a.entity_id)
    when 'job' then (select t.ticket_no from jobs j join tickets t on t.id = j.ticket_id where j.id::text = a.entity_id)
    when 'ticket' then (select t.ticket_no from tickets t where t.id::text = a.entity_id)
    when 'quotation' then (select q.quote_no from quotations q where q.id::text = a.entity_id)
    when 'customer' then (select c.company_name from customers c where c.id::text = a.entity_id)
    when 'inv_document' then (select d.doc_no from inv_documents d where d.id::text = a.entity_id)
    when 'inv_count' then (select c.count_no from inv_counts c where c.id::text = a.entity_id)
    when 'inv_item' then (select i.code from inv_items i where i.id::text = a.entity_id)
    when 'supplier' then (select s.name from inv_suppliers s where s.id::text = a.entity_id)
    when 'machine' then (select m.name from machines m where m.id::text = a.entity_id)
    when 'user' then (select u.full_name from app_users u where u.id::text = a.entity_id)
    when 'role' then (select r.name from roles r where r.id::text = a.entity_id)
  end`;

export function recordHref(type: string | null, id: string | null): string | null {
  if (!type || !id) return null;
  const links: Record<string, string> = {
    lead: `/crm/enquiries/${id}`,
    job: `/planning/jobs?job=${id}`,
    ticket: `/orders?ticket=${id}`,
    quotation: `/quotations/${id}`,
    customer: `/customers/${id}`,
    inv_document: `/inventory/movements/${id}`,
    inv_count: `/inventory/counts/${id}`,
    inv_item: `/inventory/items/${id}`,
    supplier: `/inventory/suppliers/${id}`,
    machine: `/planning/machines/${id}`,
    user: `/settings/users/${id}`,
    role: `/settings/roles/${id}`,
  };
  return links[type] ?? null;
}

export async function listActivity(f: ActivityFilters = {}) {
  await connection();
  const me = await need(["users.manage"]);
  const where: SQL[] = [sql`true`];
  if (f.user) where.push(sql`(a.user_id = ${f.user} or a.on_behalf_of_user_id = ${f.user})`);
  if (f.area) where.push(sql`a.area = ${f.area}`);
  if (f.from) where.push(sql`a.created_at >= (${f.from}::date::timestamp at time zone 'Asia/Kolkata')`);
  if (f.to) where.push(sql`a.created_at < ((${f.to}::date + 1)::timestamp at time zone 'Asia/Kolkata')`);
  const limit = f.limit ?? 200;
  const r = await db.execute<{ id: number; at: string; who: string | null; for_name: string | null; area: string; action: string; summary: string; entity_type: string | null; entity_id: string | null; record: string | null; ip: string | null }>(sql`
    select a.id, a.created_at::text as at, u.full_name as who, b.full_name as for_name, a.area, a.action, a.summary, a.entity_type, a.entity_id,
      ${RECORD_SQL} as record, a.ip
    from activity_log a
    left join app_users u on u.id = a.user_id
    left join app_users b on b.id = a.on_behalf_of_user_id
    where ${sql.join(where, sql` and `)}
    order by a.created_at desc, a.id desc
    limit ${limit + 1}`);
  // Sale prices in the wording (payments, rates) are hidden from anyone who may not see them.
  const sale = moneyView(me).sale;
  const rows = r.rows.slice(0, limit).map((x) => ({
    id: x.id,
    at: new Date(x.at).toISOString(),
    who: x.who ?? (x.area === "Sign-in" ? "Not signed in" : "System"),
    forName: x.for_name,
    area: x.area,
    action: x.action,
    summary: sale ? x.summary : hideRupees(x.summary),
    record: x.record,
    href: x.record ? recordHref(x.entity_type, x.entity_id) : null,
    // The IP address is shown for sign-ins.
    ip: x.area === "Sign-in" ? x.ip : null,
  }));
  return { rows, more: r.rows.length > limit, limit };
}
export type ActivityRow = Awaited<ReturnType<typeof listActivity>>["rows"][number];

/** People to filter by: everyone who appears in the log. */
export async function getActivityOptions() {
  await connection();
  await need(["users.manage"]);
  const r = await db.execute<{ id: string; name: string }>(sql`
    select u.id, u.full_name as name from app_users u
    where exists (select 1 from activity_log a where a.user_id = u.id or a.on_behalf_of_user_id = u.id)
    order by u.full_name`);
  return { users: r.rows, areas: [...ACTIVITY_AREAS] };
}

/** How big the log is, its oldest entry, and how long entries are kept (shown above the list). */
export async function getActivityStats() {
  await connection();
  await need(["users.manage"]);
  const r = await db.execute<{ n: string; bytes: string; oldest: string | null; months: number; attempts: string; days: number }>(sql`
    select (select count(*) from activity_log) as n, pg_total_relation_size('activity_log') as bytes,
      (select min(created_at)::text from activity_log) as oldest,
      (select activity_keep_months from settings where id = 1) as months,
      (select count(*) from sign_in_attempts) as attempts,
      (select sign_in_keep_days from settings where id = 1) as days`);
  const x = r.rows[0];
  return { entries: Number(x.n), bytes: Number(x.bytes), oldest: x.oldest ? new Date(x.oldest).toISOString() : null, months: x.months ?? 24, attempts: Number(x.attempts), days: x.days ?? 90 };
}
export type ActivityStats = Awaited<ReturnType<typeof getActivityStats>>;
