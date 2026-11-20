/**
 * Read-only Inventory queries used by pages. Every function calls connection() first,
 * so data is always read fresh at request time (and the build never touches the database).
 */
import "server-only";
import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import { connection } from "next/server";
import { db } from "@/db";
import { ensureInventoryDefaults } from "@/db/inv-defaults";
import { previewItemCode } from "@/db/inv-master-writer";
import {
  departments,
  invAdjustReasons,
  invBatches,
  invCategories,
  invDocuments,
  invMovements,
  invItemDepartments,
  invItems,
  invPurposes,
  invServiceMaterials,
  invSupplierItems,
  invSuppliers,
  invUnits,
  services,
  settings,
  teamMembers,
} from "@/db/schema";
import { valuePaise } from "@/lib/inventory/numbers";
import { stockStatus, type StockStatus } from "@/lib/inventory/stock";
import { financialYear } from "@/lib/pricing";
import { addDays, todayInIndia } from "@/lib/tickets";

export type InvListItem = { id: string; name: string; isActive: boolean };

/** Categories, units, purposes and reasons (hidden ones included), team members and departments. */
export async function getInvLists() {
  await connection();
  const [first] = await db.select({ id: invCategories.id }).from(invCategories).limit(1);
  if (!first) await ensureInventoryDefaults(db);
  const list = (t: typeof invCategories | typeof invUnits | typeof invPurposes | typeof invAdjustReasons) =>
    db.select({ id: t.id, name: t.name, isActive: t.isActive }).from(t).orderBy(asc(t.sortOrder), asc(t.name));
  const [categories, units, purposes, reasons, team, depts] = await Promise.all([
    list(invCategories),
    list(invUnits),
    list(invPurposes),
    list(invAdjustReasons),
    db.select({ id: teamMembers.id, name: teamMembers.name, isActive: teamMembers.isActive }).from(teamMembers).orderBy(asc(teamMembers.sortOrder), asc(teamMembers.name)),
    db.select({ code: departments.code, name: departments.name }).from(departments).orderBy(asc(departments.sortOrder)),
  ]);
  return { categories, units, purposes, reasons, team, departments: depts };
}
export type InvLists = Awaited<ReturnType<typeof getInvLists>>;

export async function getInvSettings() {
  await connection();
  const [s] = await db.select().from(settings).where(eq(settings.id, 1));
  if (!s) throw new Error("Settings are missing. Run: npm run db:seed");
  return s;
}

export interface ItemRow {
  id: string;
  code: string;
  name: string;
  categoryId: string;
  categoryName: string;
  unit: string;
  depts: string[];
  qty: string;
  avgCost: string;
  valuePaise: number;
  reorderLevel: string;
  reorderQty: string;
  leadTimeDays: number | null;
  status: StockStatus;
  expiringSoon: boolean;
  trackBatches: boolean;
  isActive: boolean;
  preferredSupplierName: string | null;
  packName: string | null;
  packSize: string | null;
}

/** Every item with what the list and filters need. */
export async function listInvItems(): Promise<ItemRow[]> {
  await connection();
  const [set] = await db.select({ days: settings.invExpiryWarningDays }).from(settings).where(eq(settings.id, 1));
  const until = addDays(todayInIndia(), set?.days ?? 30);
  const [rows, depts, expiring] = await Promise.all([
    db
      .select({ i: invItems, categoryName: invCategories.name, unit: invUnits.name, supplier: invSuppliers.name })
      .from(invItems)
      .innerJoin(invCategories, eq(invCategories.id, invItems.categoryId))
      .innerJoin(invUnits, eq(invUnits.id, invItems.unitId))
      .leftJoin(invSuppliers, eq(invSuppliers.id, invItems.preferredSupplierId))
      .orderBy(asc(invItems.name)),
    db.select().from(invItemDepartments),
    db
      .selectDistinct({ itemId: invBatches.itemId })
      .from(invBatches)
      .where(and(gt(invBatches.qtyOnHand, "0"), sql`${invBatches.expiryDate} is not null`, sql`${invBatches.expiryDate} <= ${until}`)),
  ]);
  const exp = new Set(expiring.map((e) => e.itemId));
  return rows.map(({ i, categoryName, unit, supplier }) => ({
    id: i.id,
    code: i.code,
    name: i.name,
    categoryId: i.categoryId,
    categoryName,
    unit,
    depts: depts.filter((d) => d.itemId === i.id).map((d) => d.deptCode),
    qty: i.qtyOnHand,
    avgCost: i.avgCost,
    valuePaise: valuePaise(i.qtyOnHand, i.avgCost),
    reorderLevel: i.reorderLevel,
    reorderQty: i.reorderQty,
    leadTimeDays: i.leadTimeDays,
    status: stockStatus(i.qtyOnHand, i.reorderLevel),
    expiringSoon: exp.has(i.id),
    trackBatches: i.trackBatches,
    isActive: i.isActive,
    preferredSupplierName: supplier,
    packName: i.packName,
    packSize: i.packSize,
  }));
}

/** One item with its batches, suppliers and prices, and the services that use it. */
export async function getInvItem(id: string) {
  await connection();
  const [row] = await db
    .select({ i: invItems, categoryName: invCategories.name, unit: invUnits.name, supplier: invSuppliers.name })
    .from(invItems)
    .innerJoin(invCategories, eq(invCategories.id, invItems.categoryId))
    .innerJoin(invUnits, eq(invUnits.id, invItems.unitId))
    .leftJoin(invSuppliers, eq(invSuppliers.id, invItems.preferredSupplierId))
    .where(eq(invItems.id, id));
  if (!row) return null;
  const [depts, batches, prices, usedBy, set] = await Promise.all([
    db.select({ code: invItemDepartments.deptCode }).from(invItemDepartments).where(eq(invItemDepartments.itemId, id)),
    db.select().from(invBatches).where(eq(invBatches.itemId, id)).orderBy(sql`${invBatches.expiryDate} asc nulls last`, asc(invBatches.receivedOn)),
    db
      .select({ supplierId: invSuppliers.id, name: invSuppliers.name, lastRate: invSupplierItems.lastRate, lastRateDate: invSupplierItems.lastRateDate, leadTimeDays: invSupplierItems.leadTimeDays })
      .from(invSupplierItems)
      .innerJoin(invSuppliers, eq(invSuppliers.id, invSupplierItems.supplierId))
      .where(eq(invSupplierItems.itemId, id))
      .orderBy(desc(invSupplierItems.lastRateDate)),
    db
      .select({ serviceId: services.id, name: services.name, deptCode: services.deptCode, unitLabel: services.unitLabel, qtyPerUnit: invServiceMaterials.qtyPerUnit })
      .from(invServiceMaterials)
      .innerJoin(services, eq(services.id, invServiceMaterials.serviceId))
      .where(eq(invServiceMaterials.itemId, id))
      .orderBy(asc(services.sortOrder)),
    db.select({ days: settings.invExpiryWarningDays }).from(settings).where(eq(settings.id, 1)),
  ]);
  const i = row.i;
  return {
    item: {
      ...i,
      categoryName: row.categoryName,
      unit: row.unit,
      preferredSupplierName: row.supplier,
      valuePaise: valuePaise(i.qtyOnHand, i.avgCost),
      status: stockStatus(i.qtyOnHand, i.reorderLevel),
      createdAt: i.createdAt.toISOString(),
      updatedAt: i.updatedAt.toISOString(),
    },
    depts: depts.map((d) => d.code),
    batches: batches.map((b) => ({ id: b.id, batchNo: b.batchNo, expiryDate: b.expiryDate, qty: b.qtyOnHand, receivedOn: b.receivedOn })),
    prices,
    usedBy,
    expiryWarningDays: set[0]?.days ?? 30,
  };
}
export type InvItemDetail = NonNullable<Awaited<ReturnType<typeof getInvItem>>>;

/** What the item form chooses from. */
export async function getItemFormOptions() {
  const [lists, suppliers, nextCode] = await Promise.all([
    getInvLists(),
    db.select({ id: invSuppliers.id, name: invSuppliers.name, isActive: invSuppliers.isActive }).from(invSuppliers).orderBy(asc(invSuppliers.name)),
    previewItemCode(db),
  ]);
  return { ...lists, suppliers, nextCode };
}
export type ItemFormOptions = Awaited<ReturnType<typeof getItemFormOptions>>;

/** Suppliers with how many items they supply and what was bought from them this financial year. */
export async function listInvSuppliers() {
  await connection();
  const fy = financialYear(new Date(`${todayInIndia()}T00:00:00`));
  const fyStart = `${fy.slice(0, 4)}-04-01`;
  const rows = await db.execute<{ id: string; name: string; contact_name: string | null; phone: string | null; email: string | null; is_active: boolean; items: string; bought: string; last_in: string | null }>(sql`
    select s.id, s.name, s.contact_name, s.phone, s.email, s.is_active,
      (select count(*) from inv_supplier_items si where si.supplier_id = s.id) as items,
      (select coalesce(sum(m.value), 0) from inv_documents d join inv_movements m on m.document_id = d.id
         where d.supplier_id = s.id and d.type = 'IN' and d.doc_date >= ${fyStart} and d.reverses_doc_id is null and d.reversed_by_doc_id is null) as bought,
      (select max(d.doc_date)::text from inv_documents d where d.supplier_id = s.id and d.type = 'IN') as last_in
    from inv_suppliers s order by s.name`);
  return rows.rows.map((r) => ({
    id: r.id,
    name: r.name,
    contactName: r.contact_name,
    phone: r.phone,
    email: r.email,
    isActive: r.is_active,
    itemCount: Number(r.items),
    boughtThisYearPaise: Number(r.bought),
    lastReceivedOn: r.last_in,
  }));
}

export async function getInvSupplier(id: string) {
  await connection();
  const [s] = await db.select().from(invSuppliers).where(eq(invSuppliers.id, id));
  if (!s) return null;
  const list = await listInvSuppliers();
  const summary = list.find((x) => x.id === id)!;
  const items = await db
    .select({ id: invItems.id, code: invItems.code, name: invItems.name, unit: invUnits.name, lastRate: invSupplierItems.lastRate, lastRateDate: invSupplierItems.lastRateDate, leadTimeDays: invSupplierItems.leadTimeDays, itemLead: invItems.leadTimeDays })
    .from(invSupplierItems)
    .innerJoin(invItems, eq(invItems.id, invSupplierItems.itemId))
    .innerJoin(invUnits, eq(invUnits.id, invItems.unitId))
    .where(eq(invSupplierItems.supplierId, id))
    .orderBy(asc(invItems.name));
  // Items that name this supplier as preferred but haven't been bought from them yet.
  const preferred = await db
    .select({ id: invItems.id, code: invItems.code, name: invItems.name, unit: invUnits.name, itemLead: invItems.leadTimeDays })
    .from(invItems)
    .innerJoin(invUnits, eq(invUnits.id, invItems.unitId))
    .where(eq(invItems.preferredSupplierId, id));
  const known = new Set(items.map((i) => i.id));
  return {
    supplier: { ...s, createdAt: s.createdAt.toISOString(), updatedAt: s.updatedAt.toISOString() },
    summary,
    items: [
      ...items,
      ...preferred.filter((p) => !known.has(p.id)).map((p) => ({ ...p, lastRate: null, lastRateDate: null, leadTimeDays: null })),
    ],
  };
}
export type InvSupplierDetail = NonNullable<Awaited<ReturnType<typeof getInvSupplier>>>;

/** Small helper for pickers. */
export async function getActiveSuppliers() {
  await connection();
  return db.select({ id: invSuppliers.id, name: invSuppliers.name }).from(invSuppliers).where(eq(invSuppliers.isActive, true)).orderBy(asc(invSuppliers.name));
}

// ---- stock forms ---------------------------------------------------------------------------------

/** Everything the Stock received / Use stock / Adjust stock forms choose from. */
export async function getStockFormData() {
  await connection();
  const today = todayInIndia();
  const [lists, items, batches, supplierItems, suppliers] = await Promise.all([
    getInvLists(),
    db
      .select({ i: invItems, unit: invUnits.name })
      .from(invItems)
      .innerJoin(invUnits, eq(invUnits.id, invItems.unitId))
      .where(eq(invItems.isActive, true))
      .orderBy(asc(invItems.name)),
    db.select().from(invBatches).where(gt(invBatches.qtyOnHand, "0")).orderBy(sql`${invBatches.expiryDate} asc nulls last`),
    db.select().from(invSupplierItems),
    db.select({ id: invSuppliers.id, name: invSuppliers.name }).from(invSuppliers).where(eq(invSuppliers.isActive, true)).orderBy(asc(invSuppliers.name)),
  ]);
  return {
    today,
    items: items.map(({ i, unit }) => ({
      id: i.id,
      code: i.code,
      name: i.name,
      unit,
      packName: i.packName,
      packSize: i.packSize,
      qty: i.qtyOnHand,
      avgCost: i.avgCost,
      trackBatches: i.trackBatches,
      lastPurchaseRate: i.lastPurchaseRate,
      preferredSupplierId: i.preferredSupplierId,
      batches: batches
        .filter((b) => b.itemId === i.id)
        .map((b) => ({ id: b.id, batchNo: b.batchNo, expiryDate: b.expiryDate, qty: b.qtyOnHand, expired: !!b.expiryDate && b.expiryDate < today })),
      supplierRates: Object.fromEntries(supplierItems.filter((s) => s.itemId === i.id && s.lastRate).map((s) => [s.supplierId, s.lastRate as string])),
    })),
    suppliers,
    team: lists.team.filter((t) => t.isActive),
    purposes: lists.purposes.filter((p) => p.isActive),
    reasons: lists.reasons.filter((r) => r.isActive),
  };
}
export type StockFormData = Awaited<ReturnType<typeof getStockFormData>>;
export type StockFormItem = StockFormData["items"][number];

// ---- use and "runs out in" -----------------------------------------------------------------------

/**
 * Average daily use per item: quantity used for jobs and internal use (not adjustments) in the
 * last N days (Settings), divided by N. Reversed records and their reversals are left out.
 */
export async function getDailyUse(): Promise<{ days: number; perItem: Map<string, number> }> {
  await connection();
  const [set] = await db.select({ days: settings.invAvgUseDays }).from(settings).where(eq(settings.id, 1));
  const days = set?.days ?? 90;
  const since = addDays(todayInIndia(), -days);
  const rows = await db.execute<{ item_id: string; used: string }>(sql`
    select m.item_id, sum(m.qty_out) as used
    from inv_movements m join inv_documents d on d.id = m.document_id
    where d.type = 'OUT' and d.reverses_doc_id is null and d.reversed_by_doc_id is null and d.doc_date > ${since}
    group by m.item_id`);
  return { days, perItem: new Map(rows.rows.map((r) => [r.item_id, Number(r.used) / days])) };
}

// ---- stock in & out records ----------------------------------------------------------------------

export interface DocFilters {
  type?: "IN" | "OUT" | "ADJ";
  item?: string;
  supplier?: string;
  ticket?: string;
  doneBy?: string;
  from?: string;
  to?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function docFiltersFromParams(p: Record<string, string | string[] | undefined>): DocFilters {
  const one = (k: string) => {
    const v = p[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
  };
  const type = one("type");
  const id = (k: string) => (UUID.test(one(k) ?? "") ? one(k) : undefined);
  const date = (k: string) => (DATE_RE.test(one(k) ?? "") ? one(k) : undefined);
  return {
    type: type === "IN" || type === "OUT" || type === "ADJ" ? type : undefined,
    item: id("item"),
    supplier: id("supplier"),
    ticket: id("ticket"),
    doneBy: id("doneBy"),
    from: date("from"),
    to: date("to"),
  };
}

/** Records, newest first, with their totals. */
export async function listInvDocuments(f: DocFilters & { id?: string } = {}, limit = 300) {
  await connection();
  const where = [sql`true`];
  if (f.id) where.push(sql`d.id = ${f.id}`);
  if (f.type) where.push(sql`d.type = ${f.type}`);
  if (f.supplier) where.push(sql`d.supplier_id = ${f.supplier}`);
  if (f.ticket) where.push(sql`d.ticket_id = ${f.ticket}`);
  if (f.doneBy) where.push(sql`d.done_by = ${f.doneBy}`);
  if (f.from) where.push(sql`d.doc_date >= ${f.from}`);
  if (f.to) where.push(sql`d.doc_date <= ${f.to}`);
  if (f.item) where.push(sql`exists (select 1 from inv_movements x where x.document_id = d.id and x.item_id = ${f.item})`);
  const rows = await db.execute<{
    id: string; doc_no: string; type: "IN" | "OUT" | "ADJ"; doc_date: string; created_at: string; supplier: string | null; bill_no: string | null; file_id: string | null;
    ticket_id: string | null; ticket_no: string | null; ticket_company: string | null; purpose: string | null; done_by: string | null; note: string | null;
    reverses: string | null; reversed_by: string | null; value_in: string; value_out: string; lines: string; items: string | null;
  }>(sql`
    select d.id, d.doc_no, d.type, d.doc_date::text, d.created_at::text, s.name as supplier, d.supplier_bill_no as bill_no, d.file_id,
      d.ticket_id, t.ticket_no, t.snapshot->>'companyName' as ticket_company, p.name as purpose, tm.name as done_by, d.note,
      r1.doc_no as reverses, r2.doc_no as reversed_by,
      coalesce(sum(case when m.qty_in > 0 then m.value end), 0) as value_in,
      coalesce(sum(case when m.qty_out > 0 then m.value end), 0) as value_out,
      count(m.id) as lines,
      string_agg(distinct i.name, ', ') as items
    from inv_documents d
    left join inv_suppliers s on s.id = d.supplier_id
    left join tickets t on t.id = d.ticket_id
    left join inv_purposes p on p.id = d.purpose_id
    left join team_members tm on tm.id = d.done_by
    left join inv_documents r1 on r1.id = d.reverses_doc_id
    left join inv_documents r2 on r2.id = d.reversed_by_doc_id
    left join inv_movements m on m.document_id = d.id
    left join inv_items i on i.id = m.item_id
    where ${sql.join(where, sql` and `)}
    group by d.id, s.name, t.ticket_no, t.snapshot, p.name, tm.name, r1.doc_no, r2.doc_no
    order by d.doc_date desc, d.created_at desc
    limit ${limit}`);
  return rows.rows.map((r) => ({
    id: r.id,
    docNo: r.doc_no,
    type: r.type,
    docDate: r.doc_date,
    supplier: r.supplier,
    billNo: r.bill_no,
    hasBill: !!r.file_id,
    ticketId: r.ticket_id,
    ticketNo: r.ticket_no,
    ticketCompany: r.ticket_company,
    purpose: r.purpose,
    doneBy: r.done_by,
    note: r.note,
    reverses: r.reverses,
    reversedBy: r.reversed_by,
    valueInPaise: Number(r.value_in),
    valueOutPaise: Number(r.value_out),
    lines: Number(r.lines),
    items: r.items ?? "",
  }));
}
export type InvDocRow = Awaited<ReturnType<typeof listInvDocuments>>[number];

/** One record with its lines. */
export async function getInvDocument(id: string) {
  await connection();
  const [row] = await listInvDocuments({ id }, 1);
  if (!row) return null;
  const [doc] = await db.select().from(invDocuments).where(eq(invDocuments.id, id));
  const lines = await db
    .select({
      id: invMovements.id,
      itemId: invItems.id,
      itemName: invItems.name,
      itemCode: invItems.code,
      unit: invUnits.name,
      batchNo: invBatches.batchNo,
      expiryDate: invBatches.expiryDate,
      qtyIn: invMovements.qtyIn,
      qtyOut: invMovements.qtyOut,
      unitCost: invMovements.unitCost,
      value: invMovements.value,
      reason: invAdjustReasons.name,
      balanceAfter: invMovements.balanceAfter,
    })
    .from(invMovements)
    .innerJoin(invItems, eq(invItems.id, invMovements.itemId))
    .innerJoin(invUnits, eq(invUnits.id, invItems.unitId))
    .leftJoin(invBatches, eq(invBatches.id, invMovements.batchId))
    .leftJoin(invAdjustReasons, eq(invAdjustReasons.id, invMovements.reasonId))
    .where(eq(invMovements.documentId, id))
    .orderBy(asc(invMovements.id));
  return { ...row, fileId: doc.fileId, supplierBillDate: doc.supplierBillDate, reversesDocId: doc.reversesDocId, reversedByDocId: doc.reversedByDocId, lines };
}
export type InvDocDetail = NonNullable<Awaited<ReturnType<typeof getInvDocument>>>;

// ---- item history, use per month, price history ---------------------------------------------------

export async function getItemHistory(itemId: string, limit = 500) {
  await connection();
  const rows = await db.execute<{
    id: number; doc_id: string; doc_no: string; type: "IN" | "OUT" | "ADJ"; doc_date: string; qty_in: string; qty_out: string; value: string; unit_cost: string;
    balance_after: string; batch_no: string | null; supplier: string | null; bill_no: string | null; ticket_id: string | null; ticket_no: string | null;
    purpose: string | null; reason: string | null; done_by: string | null; note: string | null; doc_note: string | null; reverses: string | null; reversed_by: string | null;
  }>(sql`
    select m.id, d.id as doc_id, d.doc_no, d.type, d.doc_date::text, m.qty_in, m.qty_out, m.value, m.unit_cost, m.balance_after, b.batch_no,
      s.name as supplier, d.supplier_bill_no as bill_no, d.ticket_id, t.ticket_no, p.name as purpose, r.name as reason, tm.name as done_by,
      m.note, d.note as doc_note, d.reverses_doc_id as reverses, d.reversed_by_doc_id as reversed_by
    from inv_movements m
    join inv_documents d on d.id = m.document_id
    left join inv_batches b on b.id = m.batch_id
    left join inv_suppliers s on s.id = d.supplier_id
    left join tickets t on t.id = d.ticket_id
    left join inv_purposes p on p.id = d.purpose_id
    left join inv_adjust_reasons r on r.id = m.reason_id
    left join team_members tm on tm.id = d.done_by
    where m.item_id = ${itemId}
    order by m.id desc
    limit ${limit}`);
  return rows.rows.map((r) => ({
    id: r.id,
    docId: r.doc_id,
    docNo: r.doc_no,
    type: r.type,
    docDate: r.doc_date,
    qtyIn: r.qty_in,
    qtyOut: r.qty_out,
    valuePaise: Number(r.value),
    unitCost: r.unit_cost,
    balanceAfter: r.balance_after,
    batchNo: r.batch_no,
    supplier: r.supplier,
    billNo: r.bill_no,
    ticketId: r.ticket_id,
    ticketNo: r.ticket_no,
    purpose: r.purpose,
    reason: r.reason,
    doneBy: r.done_by,
    note: r.note ?? r.doc_note,
    isReversal: !!r.reverses,
    isReversed: !!r.reversed_by,
  }));
}
export type ItemHistoryRow = Awaited<ReturnType<typeof getItemHistory>>[number];

/** Quantity used per month (jobs and internal use, not reversed), for the last 12 months (India time). */
export async function getItemUsageByMonth(itemId: string) {
  await connection();
  const today = todayInIndia();
  const start = `${addDays(`${today.slice(0, 7)}-01`, -330).slice(0, 7)}-01`;
  const rows = await db.execute<{ month: string; used: string }>(sql`
    select to_char(d.doc_date, 'YYYY-MM') as month, sum(m.qty_out) as used
    from inv_movements m join inv_documents d on d.id = m.document_id
    where m.item_id = ${itemId} and d.type = 'OUT' and d.reverses_doc_id is null and d.reversed_by_doc_id is null and d.doc_date >= ${start}
    group by 1 order by 1`);
  const used = new Map(rows.rows.map((r) => [r.month, Number(r.used)]));
  const months: { month: string; used: number }[] = [];
  let y = +today.slice(0, 4);
  let m = +today.slice(5, 7);
  for (let k = 0; k < 12; k++) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    months.unshift({ month: key, used: used.get(key) ?? 0 });
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return months;
}

/** Every purchase rate (stock received, not reversed), oldest first. */
export async function getItemPriceHistory(itemId: string) {
  await connection();
  const rows = await db.execute<{ date: string; rate: string; supplier: string | null; doc_no: string }>(sql`
    select coalesce(d.supplier_bill_date, d.doc_date)::text as date, m.unit_cost as rate, s.name as supplier, d.doc_no
    from inv_movements m join inv_documents d on d.id = m.document_id left join inv_suppliers s on s.id = d.supplier_id
    where m.item_id = ${itemId} and d.type = 'IN' and m.qty_in > 0 and d.reverses_doc_id is null and d.reversed_by_doc_id is null
    order by 1, m.id`);
  return rows.rows.map((r) => ({ date: r.date, rate: Number(r.rate), supplier: r.supplier ?? "", docNo: r.doc_no }));
}

/** Every line of the given records (for the Excel download). */
export async function getLinesForDocs(docIds: string[]) {
  await connection();
  if (!docIds.length) return [];
  const rows = await db.execute<{ document_id: string; item: string; code: string; unit: string; batch_no: string | null; qty_in: string; qty_out: string; unit_cost: string; value: string; reason: string | null; balance_after: string }>(sql`
    select m.document_id, i.name as item, i.code, u.name as unit, b.batch_no, m.qty_in, m.qty_out, m.unit_cost, m.value, r.name as reason, m.balance_after
    from inv_movements m join inv_items i on i.id = m.item_id join inv_units u on u.id = i.unit_id
    left join inv_batches b on b.id = m.batch_id left join inv_adjust_reasons r on r.id = m.reason_id
    where m.document_id = any(${sql.param(docIds)}::uuid[])
    order by m.id`);
  return rows.rows;
}
