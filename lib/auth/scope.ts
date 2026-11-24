/**
 * Department scope (section 3.3): a permission marked "own departments" only works on jobs,
 * machines and items of the person's departments. These look up the department of what is being
 * changed and refuse (with a plain message) when it is outside.
 */
import "server-only";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { UserFacingError } from "@/db/quote-writer";
import { invItemDepartments, jobBookings, jobs, machines, tickets } from "@/db/schema";
import { can } from "./can";
import { denyMessage, signedInUser } from "./guard";
import type { Permission } from "./permissions";

/** Each item's departments (an item can belong to several). */
export async function itemDepts(itemIds: string[]): Promise<Map<string, string[]>> {
  const ids = [...new Set(itemIds)];
  const rows = ids.length ? await db.select().from(invItemDepartments).where(inArray(invItemDepartments.itemId, ids)) : [];
  const m = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const r of rows) m.get(r.itemId)!.push(r.deptCode);
  return m;
}

export async function ticketDept(ticketId: string): Promise<string | null> {
  const [t] = await db.select({ d: sql<string | null>`${tickets.snapshot}->>'deptCode'` }).from(tickets).where(eq(tickets.id, ticketId));
  return t?.d ?? null;
}

export async function jobDept(jobId: string): Promise<string | null> {
  const [j] = await db.select({ d: sql<string | null>`${tickets.snapshot}->>'deptCode'` }).from(jobs).innerJoin(tickets, eq(tickets.id, jobs.ticketId)).where(eq(jobs.id, jobId));
  return j?.d ?? null;
}

export async function machineDept(machineId: string): Promise<string | null> {
  const [m] = await db.select({ d: machines.deptCode }).from(machines).where(eq(machines.id, machineId));
  return m?.d ?? null;
}

export async function bookingJobId(bookingId: string): Promise<string | null> {
  const [b] = await db.select({ j: jobBookings.jobId }).from(jobBookings).where(eq(jobBookings.id, bookingId));
  return b?.j ?? null;
}

/**
 * Throws a plain message unless the signed-in person may use `perm` on every one of these.
 * Each entry is one record's department(s); a record with several departments needs any one.
 */
export async function assertInScope(perm: Permission, records: (string | null | string[])[]) {
  const me = await signedInUser();
  for (const d of records) {
    if (!can(me, perm, { dept: d })) throw new UserFacingError(denyMessage(perm, d ?? null));
  }
}

/** Items in scope: a stock item without any department counts as everyone's. */
export async function assertItemsInScope(perm: Permission, itemIds: string[]) {
  const depts = await itemDepts(itemIds);
  const me = await signedInUser();
  for (const [, d] of depts) {
    if (d.length && !can(me, perm, { dept: d })) throw new UserFacingError(denyMessage(perm, d));
  }
}
