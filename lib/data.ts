/**
 * Read-only queries used by pages. Every function calls connection() so
 * Next.js always reads fresh data at request time (this is a live ERP,
 * nothing here should be prerendered or cached).
 */
import "server-only";
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { connection } from "next/server";
import { db } from "@/db";
import {
  customerDepartments,
  customers,
  customerServices,
  departments,
  quotationItems,
  quotations,
  quoteCounters,
  services,
  settings,
} from "@/db/schema";
import { financialYear, formatQuoteNo } from "@/lib/pricing";

export async function getSettings() {
  await connection();
  const [row] = await db.select().from(settings).where(eq(settings.id, 1));
  if (!row) throw new Error("Settings are missing. Run: npm run db:seed");
  return row;
}

export async function getDepartments() {
  await connection();
  return db.select().from(departments).orderBy(asc(departments.sortOrder));
}

export async function getServices(opts: { activeOnly?: boolean } = {}) {
  await connection();
  return db
    .select()
    .from(services)
    .where(opts.activeOnly ? eq(services.isActive, true) : undefined)
    .orderBy(asc(services.sortOrder));
}

export type CustomerFilters = {
  q?: string;
  dept?: string;
  category?: string;
  member?: string;
};

export async function listCustomers(f: CustomerFilters = {}) {
  await connection();
  const where: (SQL | undefined)[] = [isNull(customers.deletedAt), eq(customers.status, "ACTIVE")];
  if (f.q?.trim()) {
    const term = `%${f.q.trim()}%`;
    const digits = f.q.replace(/\D/g, "");
    where.push(
      or(
        ilike(customers.companyName, term),
        ilike(customers.pocName, term),
        ilike(customers.gstin, term),
        digits.length >= 3 ? ilike(customers.pocPhone, `%${digits}%`) : undefined,
      ),
    );
  }
  if (f.category && ["OEM", "TIER1", "TIER2", "MSME"].includes(f.category)) {
    where.push(eq(customers.category, f.category as "OEM"));
  }
  if (f.member === "yes") where.push(eq(customers.isMcciaMember, true));
  if (f.member === "no") where.push(eq(customers.isMcciaMember, false));
  if (f.dept) {
    where.push(
      inArray(
        customers.id,
        db.select({ id: customerDepartments.customerId }).from(customerDepartments).where(eq(customerDepartments.deptCode, f.dept)),
      ),
    );
  }

  const rows = await db.select().from(customers).where(and(...where)).orderBy(asc(customers.companyName));
  const depts = rows.length
    ? await db.select().from(customerDepartments).where(inArray(customerDepartments.customerId, rows.map((r) => r.id)))
    : [];
  return rows.map((r) => ({
    ...r,
    deptCodes: depts.filter((d) => d.customerId === r.id).map((d) => d.deptCode).sort(deptSort),
  }));
}

const DEPT_ORDER = ["RPT", "PPF", "ENV", "RPL"];
export const deptSort = (a: string, b: string) => DEPT_ORDER.indexOf(a) - DEPT_ORDER.indexOf(b);

export async function getCustomer(id: string, opts: { includeDrafts?: boolean } = {}) {
  await connection();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, id), isNull(customers.deletedAt), opts.includeDrafts ? undefined : eq(customers.status, "ACTIVE")));
  if (!row) return null;
  const [depts, svcs] = await Promise.all([
    db.select().from(customerDepartments).where(eq(customerDepartments.customerId, id)),
    db.select({ serviceId: customerServices.serviceId }).from(customerServices).where(eq(customerServices.customerId, id)),
  ]);
  return {
    ...row,
    deptCodes: depts.map((d) => d.deptCode).sort(deptSort),
    serviceIds: svcs.map((s) => s.serviceId),
  };
}
export type CustomerWithLinks = NonNullable<Awaited<ReturnType<typeof getCustomer>>>;

/** All active customers with their departments and services, for the quotation builder picker. */
export async function getCustomersForPicker() {
  await connection();
  const rows = await db
    .select()
    .from(customers)
    .where(and(isNull(customers.deletedAt), eq(customers.status, "ACTIVE")))
    .orderBy(asc(customers.companyName));
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [depts, svcs] = await Promise.all([
    db.select().from(customerDepartments).where(inArray(customerDepartments.customerId, ids)),
    db.select().from(customerServices).where(inArray(customerServices.customerId, ids)),
  ]);
  return rows.map((r) => ({
    ...r,
    deptCodes: depts.filter((d) => d.customerId === r.id).map((d) => d.deptCode).sort(deptSort),
    serviceIds: svcs.filter((s) => s.customerId === r.id).map((s) => s.serviceId),
  }));
}

export type QuotationFilters = {
  q?: string;
  status?: string;
  from?: string;
  to?: string;
  customerId?: string;
};

export async function listQuotations(f: QuotationFilters = {}) {
  await connection();
  const where: (SQL | undefined)[] = [isNull(quotations.deletedAt)];
  if (f.q?.trim()) {
    const term = `%${f.q.trim()}%`;
    where.push(or(ilike(quotations.quoteNo, term), sql`${quotations.customerSnapshot}->>'companyName' ilike ${term}`));
  }
  if (f.status && ["DRAFT", "SENT", "ACCEPTED", "REJECTED"].includes(f.status)) {
    where.push(eq(quotations.status, f.status as "DRAFT"));
  }
  if (f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from)) where.push(gte(quotations.quoteDate, f.from));
  if (f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to)) where.push(lte(quotations.quoteDate, f.to));
  if (f.customerId) where.push(eq(quotations.customerId, f.customerId));
  return db
    .select({
      id: quotations.id,
      quoteNo: quotations.quoteNo,
      companyName: sql<string>`${quotations.customerSnapshot}->>'companyName'`,
      customerId: quotations.customerId,
      quoteDate: quotations.quoteDate,
      validUntil: quotations.validUntil,
      grandTotal: quotations.grandTotal,
      status: quotations.status,
    })
    .from(quotations)
    .where(and(...where))
    .orderBy(desc(quotations.quoteDate), desc(quotations.seq));
}
export type QuotationListRow = Awaited<ReturnType<typeof listQuotations>>[number];

export async function getQuotation(id: string) {
  await connection();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [q] = await db.select().from(quotations).where(and(eq(quotations.id, id), isNull(quotations.deletedAt)));
  if (!q) return null;
  const items = await db
    .select()
    .from(quotationItems)
    .where(eq(quotationItems.quotationId, id))
    .orderBy(asc(quotationItems.sortOrder));
  return { ...q, items };
}
export type QuotationWithItems = NonNullable<Awaited<ReturnType<typeof getQuotation>>>;

export async function getDashboardStats() {
  await connection();
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const [[c], [m], [p]] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(customers)
      .where(and(isNull(customers.deletedAt), eq(customers.status, "ACTIVE"))),
    db
      .select({ n: sql<number>`count(*)::int`, total: sql<string>`coalesce(sum(${quotations.grandTotal}), 0)` })
      .from(quotations)
      .where(and(isNull(quotations.deletedAt), gte(quotations.quoteDate, monthStart))),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(quotations)
      .where(and(isNull(quotations.deletedAt), inArray(quotations.status, ["DRAFT", "SENT"]))),
  ]);
  return { customers: c.n, quotesThisMonth: m.n, totalThisMonth: m.total, pending: p.n };
}

/** The number the next quotation will most likely get. The real number is only taken on save. */
export async function getNextQuoteNoPreview() {
  await connection();
  const fy = financialYear(new Date());
  const [s] = await db.select({ prefix: settings.quotePrefix }).from(settings).where(eq(settings.id, 1));
  const [c] = await db.select().from(quoteCounters).where(eq(quoteCounters.fy, fy));
  return formatQuoteNo(s?.prefix ?? "ACDRI/QT", fy, (c?.lastSeq ?? 0) + 1);
}
