/**
 * Inventory items and suppliers. Kept free of Next.js imports so scripts and tests can use it.
 * Stock itself is never typed in here: it only changes through movements (stock-writer.ts).
 */
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { normalizeMobile } from "@/lib/crm/contact";
import { parseQty, parseRate } from "@/lib/inventory/numbers";
import type { ItemFormValues, SupplierFormValues } from "@/lib/validation/inventory";
import type { DB, Tx } from "./client";
import { UserFacingError } from "./quote-writer";
import { departments, invCategories, invCounters, invItemDepartments, invItems, invServiceMaterials, invSuppliers, invUnits, services, settings } from "./schema";

/** Takes the next number for a counter key ("ITEM", "IN:2026-27", ...). Locked inside the transaction. */
export async function nextInvSeq(tx: Tx | DB, key: string): Promise<number> {
  const [row] = await tx
    .insert(invCounters)
    .values({ key, lastSeq: 1 })
    .onConflictDoUpdate({ target: invCounters.key, set: { lastSeq: sql`${invCounters.lastSeq} + 1` } })
    .returning({ seq: invCounters.lastSeq });
  return row.seq;
}

export const formatItemCode = (prefix: string, seq: number) => `${prefix}-${String(seq).padStart(4, "0")}`;

/** The code a new item will most likely get (shown in the form; the real one is taken on save). */
export async function previewItemCode(db: DB | Tx): Promise<string> {
  const [set] = await db.select({ p: settings.invItemPrefix }).from(settings).where(eq(settings.id, 1));
  const [c] = await db.select().from(invCounters).where(eq(invCounters.key, "ITEM"));
  return formatItemCode(set?.p ?? "ITM", (c?.lastSeq ?? 0) + 1);
}

const clean = (v: string | null | undefined) => {
  const t = (v ?? "").trim().replace(/\s+/g, " ");
  return t || null;
};

async function itemRow(tx: Tx, v: ItemFormValues) {
  const [cat] = await tx.select({ id: invCategories.id }).from(invCategories).where(eq(invCategories.id, v.categoryId));
  if (!cat) throw new UserFacingError("That category could not be found. Please choose another.");
  const [unit] = await tx.select({ id: invUnits.id }).from(invUnits).where(eq(invUnits.id, v.unitId));
  if (!unit) throw new UserFacingError("That unit could not be found. Please choose another.");
  if (v.preferredSupplierId) {
    const [sup] = await tx.select({ id: invSuppliers.id }).from(invSuppliers).where(eq(invSuppliers.id, v.preferredSupplierId));
    if (!sup) throw new UserFacingError("That supplier could not be found.");
  }
  const depts = [...new Set(v.deptCodes)];
  if (depts.length) {
    const found = await tx.select({ code: departments.code }).from(departments).where(inArray(departments.code, depts));
    if (found.length !== depts.length) throw new UserFacingError("One of the departments could not be found.");
  }
  return {
    row: {
      name: clean(v.name)!,
      categoryId: cat.id,
      unitId: unit.id,
      packName: clean(v.packName),
      packSize: v.packSize ? parseQty(v.packSize) : null,
      reorderLevel: parseQty(v.reorderLevel) ?? "0",
      reorderQty: parseQty(v.reorderQty) ?? "0",
      leadTimeDays: v.leadTimeDays ? Number(v.leadTimeDays) : null,
      preferredSupplierId: v.preferredSupplierId || null,
      storagePlace: clean(v.storagePlace),
      trackBatches: v.trackBatches,
      hsnCode: clean(v.hsnCode),
      notes: v.notes.trim() || null,
      isActive: v.isActive,
    },
    depts,
  };
}

async function codeTaken(tx: Tx, code: string, exceptId?: string) {
  const where = exceptId ? and(sql`lower(${invItems.code}) = lower(${code})`, ne(invItems.id, exceptId)) : sql`lower(${invItems.code}) = lower(${code})`;
  return (await tx.select({ id: invItems.id }).from(invItems).where(where)).length > 0;
}
async function nameTaken(tx: Tx, name: string, exceptId?: string) {
  const where = exceptId ? and(sql`lower(${invItems.name}) = lower(${name})`, ne(invItems.id, exceptId)) : sql`lower(${invItems.name}) = lower(${name})`;
  return (await tx.select({ id: invItems.id }).from(invItems).where(where)).length > 0;
}

/**
 * Creates an item. An empty code (or the suggested one) takes the next ITM-0001 number;
 * a code typed by staff is kept if no other item has it.
 */
export async function createItem(db: DB | Tx, v: ItemFormValues, opts: { suggestedCode?: string } = {}) {
  return db.transaction(async (tx) => {
    const { row, depts } = await itemRow(tx, v);
    if (await nameTaken(tx, row.name)) throw new UserFacingError(`There is already an item called “${row.name}”.`);
    let code = clean(v.code)?.toUpperCase() ?? null;
    if (!code || code === opts.suggestedCode?.toUpperCase()) {
      const [set] = await tx.select({ p: settings.invItemPrefix }).from(settings).where(eq(settings.id, 1));
      // Skip numbers someone already typed by hand.
      do code = formatItemCode(set?.p ?? "ITM", await nextInvSeq(tx, "ITEM"));
      while (await codeTaken(tx, code));
    } else if (await codeTaken(tx, code)) throw new UserFacingError(`Item code ${code} is already used. Please choose another, or leave it empty for the next number.`);
    const [item] = await tx
      .insert(invItems)
      .values({ ...row, code })
      .returning();
    if (depts.length) await tx.insert(invItemDepartments).values(depts.map((deptCode) => ({ itemId: item.id, deptCode })));
    return item;
  });
}

export async function updateItem(db: DB, id: string, v: ItemFormValues) {
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(invItems).where(eq(invItems.id, id)).for("update");
    if (!before) throw new UserFacingError("This item could not be found.");
    const { row, depts } = await itemRow(tx, v);
    if (await nameTaken(tx, row.name, id)) throw new UserFacingError(`There is already an item called “${row.name}”.`);
    const code = clean(v.code)?.toUpperCase() ?? before.code;
    if (code !== before.code && (await codeTaken(tx, code, id))) throw new UserFacingError(`Item code ${code} is already used. Please choose another.`);
    if (row.unitId !== before.unitId && Number(before.qtyOnHand) > 0) throw new UserFacingError("The unit can't be changed while the item has stock.");
    // Batches can be switched on any time, but not off while batches still hold stock.
    if (before.trackBatches && !row.trackBatches && Number(before.qtyOnHand) > 0)
      throw new UserFacingError("Batch tracking can't be turned off while this item has stock in batches. Use or adjust the stock first.");
    if (!before.trackBatches && row.trackBatches && Number(before.qtyOnHand) > 0)
      throw new UserFacingError("Batch tracking can only be turned on while stock is 0, so every unit belongs to a batch. Adjust the stock to 0 first, then receive it again with batch numbers.");
    await tx.update(invItems).set({ ...row, code }).where(eq(invItems.id, id));
    await tx.delete(invItemDepartments).where(eq(invItemDepartments.itemId, id));
    if (depts.length) await tx.insert(invItemDepartments).values(depts.map((deptCode) => ({ itemId: id, deptCode })));
  });
}

function supplierRow(v: SupplierFormValues) {
  return {
    name: clean(v.name)!,
    contactName: clean(v.contactName),
    phone: normalizeMobile(v.phone),
    email: clean(v.email)?.toLowerCase() ?? null,
    gstin: clean(v.gstin)?.toUpperCase() ?? null,
    address: v.address.trim() || null,
    notes: v.notes.trim() || null,
    isActive: v.isActive,
  };
}

async function supplierNameTaken(db: DB | Tx, name: string, exceptId?: string) {
  const where = exceptId ? and(sql`lower(${invSuppliers.name}) = lower(${name})`, ne(invSuppliers.id, exceptId)) : sql`lower(${invSuppliers.name}) = lower(${name})`;
  return (await db.select({ id: invSuppliers.id }).from(invSuppliers).where(where)).length > 0;
}

export async function createSupplier(db: DB | Tx, v: SupplierFormValues) {
  const row = supplierRow(v);
  if (await supplierNameTaken(db, row.name)) throw new UserFacingError(`There is already a supplier called “${row.name}”.`);
  const [s] = await db.insert(invSuppliers).values(row).returning();
  return s;
}

export async function updateSupplier(db: DB, id: string, v: SupplierFormValues) {
  const row = supplierRow(v);
  if (await supplierNameTaken(db, row.name, id)) throw new UserFacingError(`There is already a supplier called “${row.name}”.`);
  const r = await db.update(invSuppliers).set(row).where(eq(invSuppliers.id, id)).returning({ id: invSuppliers.id });
  if (!r.length) throw new UserFacingError("This supplier could not be found.");
}

// ---- materials per service (Rate Card > Materials used) ---------------------------------------

/** Replaces a service's materials list. Only used for suggestions; actual use is always confirmed by staff. */
export async function setServiceMaterials(db: DB, serviceId: number, lines: { itemId: string; qtyPerUnit: string }[]) {
  return db.transaction(async (tx) => {
    const [svc] = await tx.select({ id: services.id }).from(services).where(eq(services.id, serviceId));
    if (!svc) throw new UserFacingError("This service could not be found.");
    const seen = new Set<string>();
    const rows: { serviceId: number; itemId: string; qtyPerUnit: string }[] = [];
    for (const [n, l] of lines.entries()) {
      if (!l.itemId) continue;
      if (seen.has(l.itemId)) throw new UserFacingError(`Line ${n + 1}: this item is already in the list.`);
      seen.add(l.itemId);
      const q = parseRate(l.qtyPerUnit);
      if (q == null || Number(q) <= 0) throw new UserFacingError(`Line ${n + 1}: enter how much is used per billing unit, e.g. 1.15 (up to 4 decimals).`);
      rows.push({ serviceId, itemId: l.itemId, qtyPerUnit: q });
    }
    if (rows.length) {
      const found = await tx.select({ id: invItems.id }).from(invItems).where(inArray(invItems.id, [...seen]));
      if (found.length !== seen.size) throw new UserFacingError("One of the items could not be found.");
    }
    await tx.delete(invServiceMaterials).where(eq(invServiceMaterials.serviceId, serviceId));
    if (rows.length) await tx.insert(invServiceMaterials).values(rows);
    return { count: rows.length };
  });
}
