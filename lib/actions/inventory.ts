"use server";

import { logActivity } from "@/lib/activity";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { createItem, createSupplier, setServiceMaterials, updateItem, updateSupplier } from "@/db/inv-master-writer";
import { UserFacingError } from "@/db/quote-writer";
import { allow } from "@/lib/auth/guard";
import type { Permission } from "@/lib/auth/permissions";
import { itemFormSchema, supplierFormSchema, type ItemFormValues, type SupplierFormValues } from "@/lib/validation/inventory";

type Result<T> = { ok: true; data: T } | { ok: false; message: string };
const id = z.string().uuid();

async function run<T>(perm: Permission | Permission[], fn: () => Promise<T>): Promise<Result<T>> {
  const g = await allow(perm);
  if (!g.ok) return { ok: false, message: g.message };
  try {
    const data = await fn();
    revalidatePath("/", "layout");
    return { ok: true, data };
  } catch (e) {
    if (e instanceof UserFacingError) return { ok: false, message: e.message };
    if (e instanceof z.ZodError) return { ok: false, message: e.issues[0]?.message ?? "Please check the details." };
    console.error("inventory", e);
    return { ok: false, message: "We couldn't save that right now. Please try again." };
  }
}

export async function saveItemAction(itemId: string | null, values: ItemFormValues, suggestedCode?: string) {
  return run("inventory.items", async () => {
    const v = itemFormSchema.parse(values);
    if (itemId) {
      await updateItem(db, id.parse(itemId), v);
      await logActivity({ area: "Inventory", action: "changed", summary: `Changed item ${v.code} ${v.name}`, entityType: "inv_item", entityId: itemId });
      return { id: itemId, code: v.code };
    }
    const item = await createItem(db, v, { suggestedCode });
    await logActivity({ area: "Inventory", action: "created", summary: `Added item ${item.code} ${v.name}`, entityType: "inv_item", entityId: item.id });
    return { id: item.id, code: item.code };
  });
}

export async function saveSupplierAction(supplierId: string | null, values: SupplierFormValues) {
  return run("inventory.suppliers", async () => {
    const v = supplierFormSchema.parse(values);
    if (supplierId) {
      await updateSupplier(db, id.parse(supplierId), v);
      await logActivity({ area: "Inventory", action: "changed", summary: `Changed supplier ${v.name.trim()}`, entityType: "supplier", entityId: supplierId });
      return { id: supplierId, name: v.name.trim() };
    }
    const s = await createSupplier(db, v);
    await logActivity({ area: "Inventory", action: "created", summary: `Added supplier ${s.name}`, entityType: "supplier", entityId: s.id });
    return { id: s.id, name: s.name };
  });
}

export async function setServiceMaterialsAction(serviceId: number, lines: { itemId: string; qtyPerUnit: string }[]) {
  return run("ratecard.time_materials", async () => {
    const sid = z.number().int().positive().parse(serviceId);
    const r = await setServiceMaterials(db, sid, z.array(z.object({ itemId: z.string().uuid().or(z.literal("")), qtyPerUnit: z.string().max(20) })).max(30).parse(lines));
    await logActivity({ area: "Rate Card", action: "materials", summary: `Changed the materials list of a service (${lines.filter((l) => l.itemId).length} items)`, entityType: "service", entityId: String(sid) });
    return r;
  });
}
