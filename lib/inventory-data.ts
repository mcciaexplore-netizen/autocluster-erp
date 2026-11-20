/**
 * Read-only Inventory queries used by pages. Every function calls connection() first,
 * so data is always read fresh at request time (and the build never touches the database).
 */
import "server-only";
import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import { connection } from "next/server";
import { db } from "@/db";
import { ensureInventoryDefaults } from "@/db/inv-defaults";
import { ticketMaterialCost } from "@/db/inv-jobs";
import { previewItemCode } from "@/db/inv-master-writer";
import {
  departments,
  invAdjustReasons,
  invBatches,
  invCategories,
  invCounts,
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
import { deliveryLate, runsOutInDays, shouldOrder } from "@/lib/inventory/calc";
import type { Material } from "@/lib/inventory/materials";
import { suggestedQty } from "@/lib/inventory/reorder";
import type { ItemImportLists } from "@/lib/inventory/import";
import { D, valuePaise } from "@/lib/inventory/numbers";
import { stockStatus, type StockStatus } from "@/lib/inventory/stock";
import { financialYear } from "@/lib/pricing";
import { addDays, daysBetween, todayInIndia } from "@/lib/tickets";

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
    db.select({ days: settings.invExpiryWarningDays, lead: settings.invDefaultLeadTimeDays }).from(settings).where(eq(settings.id, 1)),
  ]);
  const i = row.i;
  const orderedFrom = i.orderedSupplierId ? prices.find((p) => p.supplierId === i.orderedSupplierId) : undefined;
  const orderedName = i.orderedSupplierId
    ? (orderedFrom?.name ?? (await db.select({ name: invSuppliers.name }).from(invSuppliers).where(eq(invSuppliers.id, i.orderedSupplierId)))[0]?.name ?? null)
    : null;
  const ordered = i.orderedOn
    ? { on: i.orderedOn, supplierName: orderedName, late: deliveryLate(i.orderedOn, i.leadTimeDays ?? orderedFrom?.leadTimeDays ?? set[0]?.lead ?? 14, todayInIndia()) }
    : null;
  return {
    ordered,
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
    /** Used when the item has no lead time of its own. */
    defaultLeadTimeDays: set[0]?.lead ?? 14,
  };
}
export type InvItemDetail = NonNullable<Awaited<ReturnType<typeof getInvItem>>>;

/** What the item form chooses from. */
export async function getItemFormOptions() {
  await connection();
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
      reason: sql<string | null>`case when ${invMovements.isOpening} then 'Opening stock' else coalesce(${sql.raw(countReason('"inv_movements"."document_id"'))}, ${invAdjustReasons.name}) end`,
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

/** A count's adjustment lines read "Stock count dd/mm/yyyy" (they have no reason from the list). */
const countReason = (docCol: string) =>
  `(select 'Stock count ' || to_char(cd.doc_date, 'DD/MM/YYYY') from inv_counts c join inv_documents cd on cd.id = c.adjustment_doc_id where c.adjustment_doc_id = ${docCol})`;

// ---- item history, use per month, price history ---------------------------------------------------

export async function getItemHistory(itemId: string, limit = 500) {
  await connection();
  const rows = await db.execute<{
    id: number; doc_id: string; doc_no: string; type: "IN" | "OUT" | "ADJ"; doc_date: string; qty_in: string; qty_out: string; value: string; unit_cost: string;
    balance_after: string; batch_no: string | null; supplier: string | null; bill_no: string | null; ticket_id: string | null; ticket_no: string | null;
    purpose: string | null; reason: string | null; done_by: string | null; note: string | null; doc_note: string | null; reverses: string | null; reversed_by: string | null;
  }>(sql`
    select m.id, d.id as doc_id, d.doc_no, d.type, d.doc_date::text, m.qty_in, m.qty_out, m.value, m.unit_cost, m.balance_after, b.batch_no,
      s.name as supplier, d.supplier_bill_no as bill_no, d.ticket_id, t.ticket_no, p.name as purpose,
      case when m.is_opening then 'Opening stock' else coalesce(${sql.raw(countReason("m.document_id"))}, r.name) end as reason, tm.name as done_by,
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
    select m.document_id, i.name as item, i.code, u.name as unit, b.batch_no, m.qty_in, m.qty_out, m.unit_cost, m.value,
      case when m.is_opening then 'Opening stock' else coalesce(${sql.raw(countReason("m.document_id"))}, r.name) end as reason, m.balance_after
    from inv_movements m join inv_items i on i.id = m.item_id join inv_units u on u.id = i.unit_id
    left join inv_batches b on b.id = m.batch_id left join inv_adjust_reasons r on r.id = m.reason_id
    where m.document_id = any(${sql.param(docIds)}::uuid[])
    order by m.id`);
  return rows.rows;
}

// ---- jobs: materials per service, tickets, material cost ------------------------------------------

/** Each service's materials list, with the items' current stock. */
export async function getServiceMaterials(): Promise<Record<number, Material[]>> {
  await connection();
  const rows = await db
    .select({ serviceId: invServiceMaterials.serviceId, itemId: invItems.id, name: invItems.name, unit: invUnits.name, qtyPerUnit: invServiceMaterials.qtyPerUnit, inStock: invItems.qtyOnHand })
    .from(invServiceMaterials)
    .innerJoin(invItems, eq(invItems.id, invServiceMaterials.itemId))
    .innerJoin(invUnits, eq(invUnits.id, invItems.unitId))
    .orderBy(asc(invItems.name));
  const out: Record<number, Material[]> = {};
  for (const r of rows) (out[r.serviceId] ??= []).push({ itemId: r.itemId, name: r.name, unit: r.unit, qtyPerUnit: r.qtyPerUnit, inStock: r.inStock });
  return out;
}

/** Tickets that stock can be used for (not cancelled), newest first, with what the suggestions need. */
export async function getTicketsForUse() {
  await connection();
  const rows = await db.execute<{
    id: string; ticket_no: string; company: string; description: string; stage: string; service_id: number | null; billable_qty: string; unit_label: string; recorded: boolean; quantity_text: string;
  }>(sql`
    select t.id, t.ticket_no, t.snapshot->>'companyName' as company, t.snapshot->>'description' as description, t.stage,
      qi.service_id, t.snapshot->>'billableQty' as billable_qty, t.snapshot->>'unitLabel' as unit_label, t.snapshot->>'quantityText' as quantity_text,
      exists(select 1 from inv_documents d where d.ticket_id = t.id and d.type = 'OUT' and d.reverses_doc_id is null and d.reversed_by_doc_id is null) as recorded
    from tickets t join quotation_items qi on qi.id = t.quotation_item_id
    where t.stage <> 'CANCELLED'
    order by t.created_at desc, t.seq desc
    limit 500`);
  return rows.rows.map((r) => ({
    id: r.id,
    ticketNo: r.ticket_no,
    company: r.company,
    description: r.description,
    stage: r.stage,
    serviceId: r.service_id,
    billableQty: r.billable_qty,
    unitLabel: r.unit_label,
    quantityText: r.quantity_text,
    recorded: r.recorded,
  }));
}
export type TicketForUse = Awaited<ReturnType<typeof getTicketsForUse>>[number];

/**
 * Materials recorded for a ticket: each item's net quantity and value (stock used minus any
 * reversals), the records, and the total material cost.
 */
export async function getTicketMaterials(ticketId: string) {
  await connection();
  return ticketMaterialCost(db, ticketId);
}
export type TicketMaterials = Awaited<ReturnType<typeof getTicketMaterials>>;

// ---- stock counts -----------------------------------------------------------------------------------

/** All counts, newest first, with progress and the value of what changed. */
export async function listCounts() {
  await connection();
  const rows = await db.execute<{
    id: string; count_no: string; status: "IN_PROGRESS" | "COMPLETED"; label: string | null; started_at: string; completed_at: string | null;
    done_by: string | null; lines: string; counted: string; adj_id: string | null; adj_no: string | null; gain: string | null; loss: string | null;
  }>(sql`
    select c.id, c.count_no, c.status, c.filter->>'label' as label, c.started_at::text, c.completed_at::text, tm.name as done_by,
      (select count(*) from inv_count_lines l where l.count_id = c.id) as lines,
      (select count(*) from inv_count_lines l where l.count_id = c.id and l.counted_qty is not null) as counted,
      d.id as adj_id, d.doc_no as adj_no,
      (select sum(m.value) from inv_movements m where m.document_id = d.id and m.qty_in > 0) as gain,
      (select sum(m.value) from inv_movements m where m.document_id = d.id and m.qty_out > 0) as loss
    from inv_counts c
    left join team_members tm on tm.id = c.done_by
    left join inv_documents d on d.id = c.adjustment_doc_id
    order by c.started_at desc
    limit 200`);
  return rows.rows.map((r) => ({
    id: r.id,
    countNo: r.count_no,
    status: r.status,
    label: r.label ?? "All items",
    startedAt: r.started_at,
    completedAt: r.completed_at,
    doneBy: r.done_by,
    lines: Number(r.lines),
    counted: Number(r.counted),
    adjustment: r.adj_id ? { id: r.adj_id, docNo: r.adj_no! } : null,
    gainPaise: Number(r.gain ?? 0),
    lossPaise: Number(r.loss ?? 0),
  }));
}
export type CountListRow = Awaited<ReturnType<typeof listCounts>>[number];

/**
 * One count with its lines. While open, each counted line is compared with the stock now (the
 * quantity frozen at the start plus or minus what moved since), valued at the average cost.
 * Once complete, the difference and value come from its Stock adjusted record.
 */
export async function getCount(id: string) {
  await connection();
  const [c] = await db
    .select({
      id: invCounts.id,
      countNo: invCounts.countNo,
      status: invCounts.status,
      filter: invCounts.filter,
      startedAt: invCounts.startedAt,
      completedAt: invCounts.completedAt,
      adjustmentDocId: invCounts.adjustmentDocId,
      doneBy: teamMembers.name,
    })
    .from(invCounts)
    .leftJoin(teamMembers, eq(teamMembers.id, invCounts.doneBy))
    .where(eq(invCounts.id, id));
  if (!c) return null;
  const adj = c.adjustmentDocId ? (await db.select({ id: invDocuments.id, docNo: invDocuments.docNo }).from(invDocuments).where(eq(invDocuments.id, c.adjustmentDocId)))[0] : null;
  const rows = await db.execute<{
    id: number; item_id: string; batch_id: string | null; system_qty: string; counted_qty: string | null; name: string; code: string; unit: string;
    category: string; place: string | null; batch_no: string | null; expiry_date: string | null; now_qty: string; avg_cost: string;
    adj_in: string | null; adj_out: string | null; adj_value: string | null;
  }>(sql`
    select l.id, l.item_id, l.batch_id, l.system_qty, l.counted_qty, i.name, i.code, u.name as unit, cat.name as category, i.storage_place as place,
      b.batch_no, b.expiry_date::text, coalesce(b.qty_on_hand, i.qty_on_hand) as now_qty, i.avg_cost,
      mv.qty_in as adj_in, mv.qty_out as adj_out, mv.value as adj_value
    from inv_count_lines l
    join inv_items i on i.id = l.item_id
    join inv_units u on u.id = i.unit_id
    join inv_categories cat on cat.id = i.category_id
    left join inv_batches b on b.id = l.batch_id
    left join lateral (
      select sum(m.qty_in) as qty_in, sum(m.qty_out) as qty_out, sum(case when m.qty_in > 0 then m.value else -m.value end) as value
      from inv_movements m
      where m.document_id = ${c.adjustmentDocId} and m.item_id = l.item_id and m.batch_id is not distinct from l.batch_id
    ) mv on true
    where l.count_id = ${id}
    order by cat.sort_order, cat.name, i.name, b.expiry_date nulls last, b.batch_no`);
  const open = c.status === "IN_PROGRESS";
  const lines = rows.rows.map((r) => {
    let diff: string | null = null;
    let valuePaise_ = 0;
    let expected = r.now_qty;
    if (open) {
      if (r.counted_qty != null) {
        const d = D(r.counted_qty).sub(D(r.now_qty));
        diff = d.toFixed(3);
        valuePaise_ = (d.isNeg() ? -1 : 1) * valuePaise(d.abs().toFixed(3), r.avg_cost);
      }
    } else if (r.counted_qty != null) {
      const d = D(r.adj_in ?? 0).sub(D(r.adj_out ?? 0));
      diff = d.toFixed(3);
      valuePaise_ = Number(r.adj_value ?? 0);
      expected = D(r.counted_qty).sub(d).toFixed(3);
    }
    return {
      id: r.id,
      itemId: r.item_id,
      batchId: r.batch_id,
      name: r.name,
      code: r.code,
      unit: r.unit,
      category: r.category,
      place: r.place,
      batchNo: r.batch_no,
      expiryDate: r.expiry_date,
      systemQty: r.system_qty,
      countedQty: r.counted_qty,
      /** Stock now (open) or at completion (complete): frozen quantity ± what moved since the start. */
      expectedQty: expected,
      /** What moved since the start (only while open). */
      movedQty: open ? D(r.now_qty).sub(D(r.system_qty)).toFixed(3) : "0.000",
      diff,
      valuePaise: valuePaise_,
    };
  });
  return {
    id: c.id,
    countNo: c.countNo,
    status: c.status,
    label: (c.filter?.label as string | undefined) ?? "All items",
    startedAt: c.startedAt.toISOString(),
    completedAt: c.completedAt?.toISOString() ?? null,
    doneBy: c.doneBy,
    adjustment: adj ?? null,
    lines,
  };
}
export type CountDetail = NonNullable<Awaited<ReturnType<typeof getCount>>>;
export type CountLine = CountDetail["lines"][number];

/** The open count, if there is one (shown on the count list and the movement forms). */
export async function getOpenCount() {
  await connection();
  const [c] = await db.select({ id: invCounts.id, countNo: invCounts.countNo }).from(invCounts).where(eq(invCounts.status, "IN_PROGRESS")).limit(1);
  return c ?? null;
}

// ---- reorder list -----------------------------------------------------------------------------------

/**
 * Items to order now (stock at or below the reorder level, or it runs out before new stock can
 * arrive), grouped by preferred supplier, with a suggested quantity, last rate and the
 * "Ordered on" marker. Also the suppliers and message templates for "Send to supplier".
 */
export async function getReorderList() {
  await connection();
  const [[set], use, rows, sups] = await Promise.all([
    db.select().from(settings).where(eq(settings.id, 1)),
    getDailyUse(),
    db.execute<{
      id: string; code: string; name: string; unit: string; qty: string; reorder_level: string; reorder_qty: string; lead: number | null; supplier_lead: number | null;
      supplier_id: string | null; pack_name: string | null; pack_size: string | null; last_rate: string | null; supplier_rate: string | null; avg_cost: string;
      ordered_on: string | null; ordered_supplier: string | null; ordered_lead: number | null;
    }>(sql`
      select i.id, i.code, i.name, u.name as unit, i.qty_on_hand as qty, i.reorder_level, i.reorder_qty, i.lead_time_days as lead, si.lead_time_days as supplier_lead,
        i.preferred_supplier_id as supplier_id, i.pack_name, i.pack_size, i.last_purchase_rate as last_rate, si.last_rate as supplier_rate, i.avg_cost,
        i.ordered_on::text, os.name as ordered_supplier, coalesce(i.lead_time_days, oi.lead_time_days) as ordered_lead
      from inv_items i
      join inv_units u on u.id = i.unit_id
      left join inv_supplier_items si on si.item_id = i.id and si.supplier_id = i.preferred_supplier_id
      left join inv_suppliers os on os.id = i.ordered_supplier_id
      left join inv_supplier_items oi on oi.item_id = i.id and oi.supplier_id = i.ordered_supplier_id
      where i.is_active
      order by i.name`),
    db
      .select({ id: invSuppliers.id, name: invSuppliers.name, contactName: invSuppliers.contactName, phone: invSuppliers.phone, email: invSuppliers.email })
      .from(invSuppliers)
      .where(eq(invSuppliers.isActive, true))
      .orderBy(asc(invSuppliers.name)),
  ]);
  const safetyDays = set?.invSafetyDays ?? 7;
  const defaultLead = set?.invDefaultLeadTimeDays ?? 14;
  const today = todayInIndia();
  const items = rows.rows
    .map((r) => {
      const daily = use.perItem.get(r.id) ?? 0;
      const runsOut = runsOutInDays(r.qty, daily);
      const leadTimeDays = r.lead ?? r.supplier_lead ?? defaultLead;
      const leadIsDefault = r.lead == null && r.supplier_lead == null;
      const rate = r.supplier_rate ?? r.last_rate ?? (D(r.avg_cost).gt(0) ? r.avg_cost : null);
      return {
        id: r.id,
        code: r.code,
        name: r.name,
        unit: r.unit,
        qty: r.qty,
        reorderLevel: r.reorder_level,
        runsOutDays: runsOut,
        leadTimeDays,
        leadIsDefault,
        supplierId: r.supplier_id,
        packName: r.pack_name,
        packSize: r.pack_size,
        suggestedQty: suggestedQty({ qty: r.qty, reorderLevel: r.reorder_level, reorderQty: r.reorder_qty, packSize: r.pack_size }),
        rate,
        orderedOn: r.ordered_on,
        orderedSupplier: r.ordered_supplier,
        deliveryLate: deliveryLate(r.ordered_on, r.ordered_lead ?? defaultLead, today),
        order: shouldOrder({ qty: r.qty, reorderLevel: r.reorder_level, runsOutDays: runsOut, leadTimeDays, safetyDays }),
        belowLevel: D(r.qty).lte(D(r.reorder_level)),
      };
    })
    .filter((i) => i.order)
    // the one that runs out first, first
    .sort((a, b) => (a.runsOutDays ?? Infinity) - (b.runsOutDays ?? Infinity) || a.name.localeCompare(b.name));
  const groups = [...new Set(items.map((i) => i.supplierId))]
    .map((sid) => ({ supplier: sups.find((s) => s.id === sid) ?? null, items: items.filter((i) => i.supplierId === sid) }))
    .sort((a, b) => (a.supplier ? 0 : 1) - (b.supplier ? 0 : 1) || (a.supplier?.name ?? "").localeCompare(b.supplier?.name ?? ""));
  return {
    groups,
    suppliers: sups,
    safetyDays,
    useDays: use.days,
    templates: { whatsapp: set?.invOrderWhatsappTemplate ?? "", emailSubject: set?.invOrderEmailSubjectTemplate ?? "", emailBody: set?.invOrderEmailBodyTemplate ?? "" },
    orgName: set?.orgName ?? "",
  };
}
export type ReorderData = Awaited<ReturnType<typeof getReorderList>>;
export type ReorderItem = ReorderData["groups"][number]["items"][number];

/** Items and supplier for an order list download (PDF / Excel), in the order given. */
export async function getOrderListData(supplierId: string | null, lines: { itemId: string; qty: string }[]) {
  await connection();
  const ids = lines.map((l) => l.itemId);
  const [[set], sup, rows] = await Promise.all([
    db.select().from(settings).where(eq(settings.id, 1)),
    supplierId ? db.select().from(invSuppliers).where(eq(invSuppliers.id, supplierId)) : Promise.resolve([]),
    ids.length
      ? db.execute<{ id: string; code: string; name: string; unit: string; pack_name: string | null; pack_size: string | null; rate: string | null }>(sql`
          select i.id, i.code, i.name, u.name as unit, i.pack_name, i.pack_size, coalesce(si.last_rate, i.last_purchase_rate) as rate
          from inv_items i join inv_units u on u.id = i.unit_id
          left join inv_supplier_items si on si.item_id = i.id and si.supplier_id = ${supplierId}
          where i.id = any(${sql.param(ids)}::uuid[])`)
      : Promise.resolve({ rows: [] }),
  ]);
  if (!set) throw new Error("Settings are missing.");
  const items = lines.flatMap((l) => {
    const r = rows.rows.find((x) => x.id === l.itemId);
    return r ? [{ ...r, qty: l.qty, valuePaise: r.rate ? valuePaise(l.qty, r.rate) : null }] : [];
  });
  return {
    org: { name: set.orgName, address: set.orgAddress, gstin: set.orgGstin, phone: set.orgPhone, email: set.orgEmail },
    supplier: sup[0] ?? null,
    items,
    today: todayInIndia(),
  };
}
export type OrderListData = Awaited<ReturnType<typeof getOrderListData>>;

// ---- overview and home ------------------------------------------------------------------------------

/** Items marked ordered whose lead time has passed without the stock arriving from that supplier. */
async function lateDeliveries(today: string, defaultLead: number) {
  const rows = await db.execute<{ id: string; name: string; code: string; ordered_on: string; supplier: string | null; lead: number | null }>(sql`
    select i.id, i.name, i.code, i.ordered_on::text, s.name as supplier, coalesce(i.lead_time_days, si.lead_time_days) as lead
    from inv_items i
    left join inv_suppliers s on s.id = i.ordered_supplier_id
    left join inv_supplier_items si on si.item_id = i.id and si.supplier_id = i.ordered_supplier_id
    where i.ordered_on is not null
    order by i.ordered_on`);
  return rows.rows.filter((r) => deliveryLate(r.ordered_on, r.lead ?? defaultLead, today)).map((r) => ({ id: r.id, name: r.name, code: r.code, orderedOn: r.ordered_on, supplier: r.supplier }));
}

/** Items with a batch in stock that expires within the warning days (or has expired): matches the "Expiring soon" filter. */
async function expiringItemCount(until: string) {
  const r = await db.execute<{ n: string }>(sql`
    select count(distinct b.item_id) as n from inv_batches b join inv_items i on i.id = b.item_id
    where i.is_active and b.qty_on_hand > 0 and b.expiry_date is not null and b.expiry_date <= ${until}`);
  return Number(r.rows[0].n);
}

/** The Inventory overview: cards, "Needs attention" and the last 10 records. */
export async function getInvOverview() {
  await connection();
  const today = todayInIndia();
  const [set] = await db.select({ warn: settings.invExpiryWarningDays, lead: settings.invDefaultLeadTimeDays }).from(settings).where(eq(settings.id, 1));
  const warnDays = set?.warn ?? 30;
  const until = addDays(today, warnDays);
  const [reorder, totals, expiringItems, batches, late, jobs, recent] = await Promise.all([
    getReorderList(),
    db.execute<{ value: string; out: string }>(sql`
      select coalesce(sum(round(qty_on_hand * avg_cost * 100)), 0) as value, count(*) filter (where is_active and qty_on_hand <= 0) as out from inv_items`),
    expiringItemCount(until),
    db.execute<{ id: string; item_id: string; name: string; unit: string; batch_no: string; expiry_date: string; qty: string; value: string }>(sql`
      select b.id, i.id as item_id, i.name, u.name as unit, b.batch_no, b.expiry_date::text, b.qty_on_hand as qty, round(b.qty_on_hand * i.avg_cost * 100) as value
      from inv_batches b join inv_items i on i.id = b.item_id join inv_units u on u.id = i.unit_id
      where b.qty_on_hand > 0 and b.expiry_date is not null and b.expiry_date <= ${until}
      order by b.expiry_date, i.name`),
    lateDeliveries(today, set?.lead ?? 14),
    // Jobs in Billing or later (Paid only in the last 30 days, as on the board) whose service has a
    // materials list but no materials recorded.
    db.execute<{ id: string; ticket_no: string; company: string; description: string; stage: string }>(sql`
      select t.id, t.ticket_no, t.snapshot->>'companyName' as company, t.snapshot->>'description' as description, t.stage
      from tickets t join quotation_items qi on qi.id = t.quotation_item_id
      where t.stage in ('BILLING', 'PAYMENT', 'PAID')
        and (t.stage <> 'PAID' or t.stage_changed_at > now() - interval '30 days')
        and exists (select 1 from inv_service_materials sm where sm.service_id = qi.service_id)
        and not exists (select 1 from inv_documents d where d.ticket_id = t.id and d.type = 'OUT' and d.reverses_doc_id is null and d.reversed_by_doc_id is null)
      order by t.stage_changed_at`),
    listInvDocuments({}, 10),
  ]);
  const toReorder = reorder.groups.flatMap((g) => g.items).sort((a, b) => (a.runsOutDays ?? Infinity) - (b.runsOutDays ?? Infinity));
  const batchRows = batches.rows.map((b) => ({ id: b.id, itemId: b.item_id, name: b.name, unit: b.unit, batchNo: b.batch_no, expiryDate: b.expiry_date, qty: b.qty, valuePaise: Number(b.value), days: daysBetween(today, b.expiry_date) }));
  return {
    warnDays,
    cards: { valuePaise: Number(totals.rows[0].value), toReorder: toReorder.length, outOfStock: Number(totals.rows[0].out), expiring: expiringItems },
    toReorder,
    late,
    expiringSoon: batchRows.filter((b) => b.days >= 0),
    expired: batchRows.filter((b) => b.days < 0),
    jobsWithoutMaterials: jobs.rows,
    recent,
  };
}
export type InvOverview = Awaited<ReturnType<typeof getInvOverview>>;

/** The 2 Inventory cards on the home page. */
export async function getInvHomeStats() {
  await connection();
  const [set] = await db.select({ warn: settings.invExpiryWarningDays }).from(settings).where(eq(settings.id, 1));
  const warnDays = set?.warn ?? 30;
  const [reorder, expiring] = await Promise.all([getReorderList(), expiringItemCount(addDays(todayInIndia(), warnDays))]);
  return { toReorder: reorder.groups.reduce((a, g) => a + g.items.length, 0), expiring, warnDays };
}

// ---- import items -----------------------------------------------------------------------------------

/** What an item import row may use, plus existing names and codes (to catch duplicates). */
export async function getItemImportLists(): Promise<ItemImportLists> {
  await connection();
  const [lists, sups, existing] = await Promise.all([
    getInvLists(),
    db.select({ id: invSuppliers.id, name: invSuppliers.name }).from(invSuppliers).where(eq(invSuppliers.isActive, true)).orderBy(asc(invSuppliers.name)),
    db.select({ name: invItems.name, code: invItems.code }).from(invItems),
  ]);
  return {
    categories: lists.categories.filter((c) => c.isActive),
    units: lists.units.filter((u) => u.isActive),
    suppliers: sups,
    departments: lists.departments,
    existingNames: new Set(existing.map((e) => e.name.trim().toLowerCase())),
    existingCodes: new Set(existing.map((e) => e.code.toUpperCase())),
  };
}
