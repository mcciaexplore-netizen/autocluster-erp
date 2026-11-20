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
