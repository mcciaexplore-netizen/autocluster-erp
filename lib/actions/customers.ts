"use server";

import { isSignedIn } from "@/lib/auth-guard";
import { SIGNED_OUT_MESSAGE } from "@/lib/auth-messages";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { customerDepartments, customers, customerServices, departments, services } from "@/db/schema";
import { stateByCode } from "@/lib/india";
import { customerDetailsSchema, customerLinksSchema, type CustomerDetailsInput } from "@/lib/validation/customer";

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; message: string; fieldErrors?: Record<string, string> };

function refresh() {
  revalidatePath("/", "layout");
}

/**
 * Step 1 of the wizard. Creates the customer as a draft (so nothing is lost),
 * or updates an existing customer's details.
 */
export async function saveCustomerDetails(
  input: CustomerDetailsInput,
  id: string | null,
): Promise<ActionResult<{ id: string }>> {
  if (!(await isSignedIn())) return { ok: false as const, message: SIGNED_OUT_MESSAGE };
  const parsed = customerDetailsSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const k = String(issue.path[0]);
      fieldErrors[k] ??= issue.message;
    }
    return { ok: false, message: "Some details need a second look.", fieldErrors };
  }
  const v = parsed.data;
  const state = stateByCode(v.stateCode)!;
  const values = {
    companyName: v.companyName,
    category: v.category,
    udyamNo: v.category === "MSME" ? v.udyamNo.toUpperCase() || null : null,
    addressLine1: v.addressLine1,
    addressLine2: v.addressLine2 || null,
    city: v.city,
    state: state.name,
    stateCode: state.code,
    pincode: v.pincode,
    gstRegistered: !v.notGstRegistered,
    gstin: v.notGstRegistered ? null : v.gstin.toUpperCase(),
    pan: v.pan.toUpperCase(),
    tan: v.tan.toUpperCase() || null,
    pocName: v.pocName,
    pocDesignation: v.pocDesignation || null,
    pocPhone: v.pocPhone,
    pocEmail: v.pocEmail.toLowerCase(),
    isMcciaMember: v.isMcciaMember === "yes",
    mcciaMembershipId: v.isMcciaMember === "yes" ? v.mcciaMembershipId : null,
  };

  try {
    if (id) {
      const [row] = await db
        .update(customers)
        .set(values)
        .where(and(eq(customers.id, id), isNull(customers.deletedAt)))
        .returning({ id: customers.id });
      if (!row) return { ok: false, message: "This customer could not be found. It may have been deleted." };
      refresh();
      return { ok: true, data: { id: row.id } };
    }
    const [row] = await db.insert(customers).values({ ...values, status: "DRAFT" }).returning({ id: customers.id });
    return { ok: true, data: { id: row.id } };
  } catch (e) {
    console.error(e);
    return { ok: false, message: "We couldn't save right now. Please try again." };
  }
}

/** Steps 2 and 3. Saves departments and services, and makes the customer active. */
export async function saveCustomerLinks(
  id: string,
  input: { deptCodes: string[]; serviceIds: number[] },
): Promise<ActionResult<{ id: string; companyName: string }>> {
  if (!(await isSignedIn())) return { ok: false as const, message: SIGNED_OUT_MESSAGE };
  const parsed = customerLinksSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const { deptCodes, serviceIds } = parsed.data;

  try {
    return await db.transaction(async (tx) => {
      const [c] = await tx
        .select({ id: customers.id, companyName: customers.companyName })
        .from(customers)
        .where(and(eq(customers.id, id), isNull(customers.deletedAt)));
      if (!c) return { ok: false as const, message: "This customer could not be found. It may have been deleted." };

      const validDepts = (await tx.select({ code: departments.code }).from(departments).where(inArray(departments.code, deptCodes))).map(
        (d) => d.code,
      );
      // Only keep services that belong to the chosen departments.
      const validServices = serviceIds.length
        ? (
            await tx
              .select({ id: services.id })
              .from(services)
              .where(and(inArray(services.id, serviceIds), inArray(services.deptCode, validDepts)))
          ).map((s) => s.id)
        : [];

      await tx.delete(customerDepartments).where(eq(customerDepartments.customerId, id));
      await tx.delete(customerServices).where(eq(customerServices.customerId, id));
      if (validDepts.length) await tx.insert(customerDepartments).values(validDepts.map((deptCode) => ({ customerId: id, deptCode })));
      if (validServices.length) await tx.insert(customerServices).values(validServices.map((serviceId) => ({ customerId: id, serviceId })));
      await tx.update(customers).set({ status: "ACTIVE" }).where(eq(customers.id, id));
      return { ok: true as const, data: { id, companyName: c.companyName } };
    });
  } catch (e) {
    console.error(e);
    return { ok: false, message: "We couldn't save right now. Please try again." };
  } finally {
    refresh();
  }
}

/** Soft delete: the customer is hidden but can be brought back with Undo. */
export async function deleteCustomer(id: string): Promise<ActionResult> {
  if (!(await isSignedIn())) return { ok: false as const, message: SIGNED_OUT_MESSAGE };
  await db.update(customers).set({ deletedAt: new Date() }).where(eq(customers.id, id));
  refresh();
  return { ok: true };
}

export async function restoreCustomer(id: string): Promise<ActionResult> {
  if (!(await isSignedIn())) return { ok: false as const, message: SIGNED_OUT_MESSAGE };
  await db.update(customers).set({ deletedAt: null }).where(eq(customers.id, id));
  refresh();
  return { ok: true };
}
