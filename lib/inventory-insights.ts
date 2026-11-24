/**
 * Inventory Insights (brief section 10.2): read-only queries for decisions. Every money value is
 * whole paise. Records that were reversed (and their reversals) are left out, as everywhere else.
 */
import "server-only";
import { sql } from "drizzle-orm";
import { moneyView, need } from "@/lib/auth/guard";
import { connection } from "next/server";
import { db } from "@/db";
import { runsOutInDays } from "@/lib/inventory/calc";
import { isSlowMoving, priceRise } from "@/lib/inventory/insights-calc";
import { D, valuePaise } from "@/lib/inventory/numbers";
import { addDays, todayInIndia } from "@/lib/tickets";

export interface InsightFilters {
  from: string;
  to: string;
  dept: string | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Default: the last 30 days. */
export async function insightFiltersFromParams(sp: Record<string, string | string[] | undefined>): Promise<InsightFilters> {
  await connection();
  await need();
  const today = todayInIndia();
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  let from = DATE_RE.test(one("from")) ? one("from") : addDays(today, -30);
  let to = DATE_RE.test(one("to")) ? one("to") : today;
  if (from > to) [from, to] = [to, from];
  const dept = /^[A-Z]{2,6}$/.test(one("dept")) ? one("dept") : null;
  return { from, to, dept };
}

/** Every month (YYYY-MM) from one date to another. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const endY = Number(to.slice(0, 4));
  const endM = Number(to.slice(5, 7));
  while (y < endY || (y === endY && m <= endM)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) [y, m] = [y + 1, 1];
  }
  return out;
}

const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : null);

/** Stock used and not reversed, in the date range, with the department of the job (or internal use). */
const usedRows = (f: InsightFilters) => sql`
  select m.item_id, d.doc_date, m.value::bigint as value,
    case when d.ticket_id is null then 'INTERNAL' else coalesce(t.snapshot->>'deptCode', 'OTHER') end as dept
  from inv_movements m
  join inv_documents d on d.id = m.document_id
  left join tickets t on t.id = d.ticket_id
  where d.type = 'OUT' and m.qty_out > 0 and d.reverses_doc_id is null and d.reversed_by_doc_id is null
    and d.doc_date between ${f.from} and ${f.to}
    ${
      f.dept
        ? sql`and (t.snapshot->>'deptCode' = ${f.dept} or (d.ticket_id is null and exists (select 1 from inv_item_departments x where x.item_id = m.item_id and x.dept_code = ${f.dept})))`
        : sql``
    }`;

const itemInDept = (f: InsightFilters, col: string) =>
  f.dept ? sql`and exists (select 1 from inv_item_departments x where x.item_id = ${sql.raw(col)} and x.dept_code = ${f.dept})` : sql``;

export async function getInsights(f: InsightFilters) {
  await connection();
  const me = await need(["insights.inventory"]);
  // Inventory Insights is about stock money, so it also needs "money.stock_costs".
  await need(["money.stock_costs"]);
  const sale = moneyView(me).sale;
  const today = todayInIndia();
  const [[set], depts] = await Promise.all([
    db.execute<{ alert: number; share: number; use_days: number; safety: number; lead: number }>(
      sql`select inv_price_rise_alert_pct as alert, inv_material_share_alert_pct as share, inv_avg_use_days as use_days, inv_safety_days as safety, inv_default_lead_time_days as lead from settings where id = 1`,
    ).then((r) => r.rows),
    db.execute<{ code: string; name: string }>(sql`select code, name from departments order by sort_order`).then((r) => r.rows),
  ]);
  const alertPct = set?.alert ?? 10;
  const shareAlertPct = set?.share ?? 40;
  const useDays = set?.use_days ?? 90;
  const safetyDays = set?.safety ?? 7;
  const defaultLead = set?.lead ?? 14;

  const [spend, items, jobs, receipts, stock, expiry, recentUse] = await Promise.all([
    // 1. material spend by month and department
    db.execute<{ month: string; dept: string; value: string }>(sql`
      select to_char(u.doc_date, 'YYYY-MM') as month, u.dept, sum(u.value) as value from (${usedRows(f)}) u group by 1, 2`),
    // 3. biggest-spend items
    db.execute<{ item_id: string; name: string; code: string; value: string }>(sql`
      select u.item_id, i.name, i.code, sum(u.value) as value from (${usedRows(f)}) u join inv_items i on i.id = u.item_id
      group by 1, 2, 3 order by sum(u.value) desc`),
    // 2. kept after materials, by service (jobs opened in the range)
    db.execute<{ service_id: number; name: string; dept_code: string; jobs: string; revenue: string; material: string; recorded: string; has_list: boolean; none_needed: boolean }>(sql`
      select s.id as service_id, s.name, s.dept_code, count(*) as jobs, sum(round(t.taxable_value * 100)) as revenue,
        sum(coalesce(mc.cost, 0)) as material, count(*) filter (where mc.recorded) as recorded,
        exists (select 1 from inv_service_materials sm where sm.service_id = s.id) as has_list, s.no_materials_needed as none_needed
      from tickets t
      join quotation_items qi on qi.id = t.quotation_item_id
      join services s on s.id = qi.service_id
      left join (
        select d.ticket_id, sum(case when m.qty_out > 0 then m.value else -m.value end) as cost,
          bool_or(d.reverses_doc_id is null and d.reversed_by_doc_id is null) as recorded
        from inv_documents d join inv_movements m on m.document_id = d.id
        where d.ticket_id is not null and d.type = 'OUT'
        group by d.ticket_id
      ) mc on mc.ticket_id = t.id
      where t.stage <> 'CANCELLED' and (t.created_at at time zone 'Asia/Kolkata')::date between ${f.from} and ${f.to}
        -- Only work that is done (or already has materials recorded): jobs still to do don't need materials yet.
        and (mc.recorded or exists (select 1 from jobs j where j.ticket_id = t.id and j.status in ('DONE', 'HANDED_OVER')) or not exists (select 1 from jobs j where j.ticket_id = t.id))
        ${f.dept ? sql`and s.dept_code = ${f.dept}` : sql``}
      group by s.id, s.name, s.dept_code, s.no_materials_needed`),
    // 4. purchase rates (receipts from suppliers, not reversed), up to the end of the range
    db.execute<{ item_id: string; name: string; unit: string; doc_date: string; rate: string; supplier: string }>(sql`
      select m.item_id, i.name, u.name as unit, d.doc_date::text, m.unit_cost as rate, s.name as supplier
      from inv_movements m join inv_documents d on d.id = m.document_id join inv_items i on i.id = m.item_id
      join inv_units u on u.id = i.unit_id join inv_suppliers s on s.id = d.supplier_id
      where d.type = 'IN' and m.qty_in > 0 and d.reverses_doc_id is null and d.reversed_by_doc_id is null and d.doc_date <= ${f.to}
        ${itemInDept(f, "m.item_id")}
      order by m.item_id, d.doc_date, m.id`),
    // 5 and 7. stock now
    db.execute<{ id: string; name: string; code: string; unit: string; category: string; qty: string; avg: string; value: string; reorder_level: string; lead: number | null; depts: string[] | null; last_used: string | null; ever_used: boolean }>(sql`
      select i.id, i.name, i.code, u.name as unit, c.name as category, i.qty_on_hand as qty, i.avg_cost as avg,
        round(i.qty_on_hand * i.avg_cost * 100) as value, i.reorder_level, coalesce(i.lead_time_days, si.lead_time_days) as lead,
        (select array_agg(x.dept_code order by x.dept_code) from inv_item_departments x where x.item_id = i.id) as depts,
        (select max(d.doc_date)::text from inv_movements m join inv_documents d on d.id = m.document_id
          where m.item_id = i.id and d.type = 'OUT' and m.qty_out > 0 and d.reverses_doc_id is null and d.reversed_by_doc_id is null) as last_used,
        exists (select 1 from inv_movements m join inv_documents d on d.id = m.document_id where m.item_id = i.id and d.type = 'OUT') as ever_used
      from inv_items i join inv_units u on u.id = i.unit_id join inv_categories c on c.id = i.category_id
      left join inv_supplier_items si on si.item_id = i.id and si.supplier_id = i.preferred_supplier_id
      where i.is_active ${itemInDept(f, "i.id")}
      order by i.name`),
    // 6. expiry losses: stock removed with the reason "Expired"
    db.execute<{ month: string; item_id: string; name: string; unit: string; qty: string; value: string }>(sql`
      select to_char(d.doc_date, 'YYYY-MM') as month, i.id as item_id, i.name, u.name as unit, sum(m.qty_out) as qty, sum(m.value) as value
      from inv_movements m join inv_documents d on d.id = m.document_id join inv_adjust_reasons r on r.id = m.reason_id
      join inv_items i on i.id = m.item_id join inv_units u on u.id = i.unit_id
      where d.type = 'ADJ' and m.qty_out > 0 and lower(r.name) = 'expired' and d.reverses_doc_id is null and d.reversed_by_doc_id is null
        and d.doc_date between ${f.from} and ${f.to} ${itemInDept(f, "i.id")}
      group by 1, 2, 3, 4 order by 1, 3`),
    // average daily use (for "Runs out in")
    db.execute<{ item_id: string; used: string }>(sql`
      select m.item_id, sum(m.qty_out) as used from inv_movements m join inv_documents d on d.id = m.document_id
      where d.type = 'OUT' and d.reverses_doc_id is null and d.reversed_by_doc_id is null and d.doc_date > ${addDays(today, -useDays)}
      group by m.item_id`),
  ]);

  // ---- 1. spend by month (stacked by department) ----
  const months = monthsBetween(f.from, f.to);
  const seriesKeys = [...depts.map((d) => d.code), "OTHER", "INTERNAL"].filter((k) => spend.rows.some((r) => r.dept === k));
  const seriesNames: Record<string, string> = { ...Object.fromEntries(depts.map((d) => [d.code, d.code])), OTHER: "Other jobs", INTERNAL: "Internal use" };
  const spendByMonth = months.map((month) => ({
    month,
    ...Object.fromEntries(seriesKeys.map((k) => [k, Number(spend.rows.find((r) => r.month === month && r.dept === k)?.value ?? 0)])),
  })) as ({ month: string } & Record<string, number>)[];
  const spendTotal = spend.rows.reduce((a, r) => a + Number(r.value), 0);

  // ---- 2. kept after materials, by service ----
  const services = jobs.rows.map((r) => {
    const revenue = Number(r.revenue);
    const material = Number(r.material);
    const kept = revenue - material;
    return {
      serviceId: r.service_id,
      name: r.name,
      deptCode: r.dept_code,
      jobs: Number(r.jobs),
      jobsRecorded: Number(r.recorded),
      revenuePaise: revenue,
      materialPaise: material,
      keptPaise: kept,
      keptPct: pct(kept, revenue),
      materialSharePct: pct(material, revenue),
      hasList: r.has_list,
      /** Rate Card "No materials needed": always 100% kept, never "not recorded". */
      noneNeeded: r.none_needed && !r.has_list,
    };
  });
  // A service with no materials list and nothing recorded would show 100%: leave it out of the ranking.
  const leftOut = services.filter((s) => !s.hasList && !s.noneNeeded && s.jobsRecorded === 0);
  const ranked = services.filter((s) => !leftOut.includes(s)).sort((a, b) => (a.keptPct ?? 101) - (b.keptPct ?? 101) || a.name.localeCompare(b.name));

  // ---- 3. biggest-spend items (top 10, running %) ----
  let running = 0;
  const topItems = items.rows.slice(0, 10).map((r) => {
    running += Number(r.value);
    return { itemId: r.item_id, name: r.name, code: r.code, valuePaise: Number(r.value), sharePct: pct(Number(r.value), spendTotal), runningPct: pct(running, spendTotal) };
  });

  // ---- 4. price changes ----
  const byItem = new Map<string, typeof receipts.rows>();
  for (const r of receipts.rows) byItem.set(r.item_id, [...(byItem.get(r.item_id) ?? []), r]);
  const rises: { itemId: string; name: string; unit: string; oldRate: string; oldDate: string; newRate: string; newDate: string; supplier: string; risePct: number }[] = [];
  for (const [itemId, rs] of byItem) {
    const r = priceRise(rs.map((x) => ({ date: x.doc_date, rate: x.rate })), f.from, f.to, alertPct);
    if (!r) continue;
    const latest = rs.at(-1)!;
    rises.push({ itemId, name: latest.name, unit: latest.unit, oldRate: r.old.rate, oldDate: r.old.date, newRate: r.latest.rate, newDate: r.latest.date, supplier: latest.supplier, risePct: r.risePct });
  }
  rises.sort((a, b) => b.risePct - a.risePct);
  const priceChanges = await withServiceEffect(rises, f);

  // ---- 5. money tied up in stock (now) ----
  const daily = new Map(recentUse.rows.map((r) => [r.item_id, Number(r.used) / useDays]));
  const inStock = stock.rows.filter((r) => D(r.qty).gt(0));
  const sumBy = (key: (r: (typeof inStock)[number]) => string[]) => {
    const m = new Map<string, number>();
    for (const r of inStock) for (const k of key(r)) m.set(k, (m.get(k) ?? 0) + Number(r.value));
    return [...m].map(([name, valuePaise]) => ({ name, valuePaise })).sort((a, b) => b.valuePaise - a.valuePaise);
  };
  const byCategory = sumBy((r) => [r.category]);
  const byDepartment = sumBy((r) => (r.depts?.length ? r.depts : ["No department"]));
  const slow = inStock
    .filter((r) => isSlowMoving({ qty: r.qty, lastUsed: r.last_used }, today, useDays))
    .map((r) => ({ itemId: r.id, name: r.name, code: r.code, qty: r.qty, unit: r.unit, valuePaise: Number(r.value), lastUsed: r.last_used, neverUsed: !r.ever_used }))
    .sort((a, b) => b.valuePaise - a.valuePaise);
  const stockValuePaise = inStock.reduce((a, r) => a + Number(r.value), 0);

  // ---- 6. expiry losses ----
  const expiryByMonth = months.map((month) => ({ month, value: expiry.rows.filter((r) => r.month === month).reduce((a, r) => a + Number(r.value), 0) }));
  const expiryItems = [...new Set(expiry.rows.map((r) => r.item_id))]
    .map((id) => {
      const rs = expiry.rows.filter((r) => r.item_id === id);
      return { itemId: id, name: rs[0].name, unit: rs[0].unit, qty: rs.reduce((a, r) => a.add(D(r.qty)), D(0)).toFixed(3), valuePaise: rs.reduce((a, r) => a + Number(r.value), 0) };
    })
    .sort((a, b) => b.valuePaise - a.valuePaise);

  // ---- 7. running out soon ----
  const runningOut = stock.rows
    .map((r) => {
      const days = runsOutInDays(r.qty, daily.get(r.id) ?? 0);
      return { itemId: r.id, name: r.name, code: r.code, qty: r.qty, unit: r.unit, runsOutDays: days, leadTimeDays: r.lead ?? defaultLead, leadIsDefault: r.lead == null };
    })
    .filter((r) => r.runsOutDays != null)
    .sort((a, b) => a.runsOutDays! - b.runsOutDays!)
    .slice(0, 15)
    .map((r) => ({
      ...r,
      verdict: (r.runsOutDays === 0 ? "out" : r.runsOutDays! <= r.leadTimeDays ? "late" : r.runsOutDays! <= r.leadTimeDays + safetyDays ? "order" : "ok") as "out" | "late" | "order" | "ok",
    }));

  return {
    filters: f,
    departments: depts,
    alertPct,
    shareAlertPct,
    useDays,
    spend: { months, series: seriesKeys.map((k) => ({ key: k, name: seriesNames[k] ?? k })), rows: spendByMonth, totalPaise: spendTotal },
    // "Kept after materials" uses sale prices (revenue): only for people who may see them.
    services: sale ? { ranked, leftOut: leftOut.map((s) => s.name), hidden: false } : { ranked: [] as typeof ranked, leftOut: [] as string[], hidden: true },
    topItems,
    priceChanges,
    tiedUp: { totalPaise: stockValuePaise, byCategory, byDepartment, slow },
    expiry: { byMonth: expiryByMonth, items: expiryItems, totalPaise: expiryItems.reduce((a, r) => a + r.valuePaise, 0) },
    runningOut,
  };
}
export type Insights = Awaited<ReturnType<typeof getInsights>>;

/**
 * For each price rise: the services that use the item, and what they keep after materials at
 * the MSME rate-card price, with the old rate and with the new one.
 */
async function withServiceEffect<T extends { itemId: string; oldRate: string; newRate: string }>(rises: T[], f: InsightFilters) {
  if (!rises.length) return [];
  const rows = await db.execute<{ service_id: number; name: string; dept_code: string; unit_label: string; rate: string; item_id: string; qty_per_unit: string; item_rate: string | null }>(sql`
    select s.id as service_id, s.name, s.dept_code, s.unit_label, s.rate_msme as rate, sm.item_id, sm.qty_per_unit,
      coalesce(i.last_purchase_rate, nullif(i.avg_cost, 0)) as item_rate
    from inv_service_materials sm join services s on s.id = sm.service_id join inv_items i on i.id = sm.item_id
    where s.id in (select service_id from inv_service_materials where item_id = any(${sql.param(rises.map((r) => r.itemId))}::uuid[]))
      ${f.dept ? sql`and s.dept_code = ${f.dept}` : sql``}`);
  return rises.map((r) => {
    const ids = [...new Set(rows.rows.filter((x) => x.item_id === r.itemId).map((x) => x.service_id))];
    const services = ids.map((id) => {
      const list = rows.rows.filter((x) => x.service_id === id);
      const price = D(list[0].rate);
      const cost = (rate: string) => list.reduce((a, x) => a.add(D(x.qty_per_unit).mul(D(x.item_id === r.itemId ? rate : (x.item_rate ?? 0)))), D(0));
      const kept = (rate: string) => (price.gt(0) ? price.sub(cost(rate)).div(price).mul(100).toNumber() : null);
      return { serviceId: id, name: list[0].name, deptCode: list[0].dept_code, unitLabel: list[0].unit_label, pricePaise: valuePaise(1, price), keptBeforePct: kept(r.oldRate), keptNowPct: kept(r.newRate) };
    });
    return { ...r, services };
  });
}
