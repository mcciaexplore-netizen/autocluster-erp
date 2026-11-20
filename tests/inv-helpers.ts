import { eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import { createItem, createSupplier } from "@/db/inv-master-writer";
import * as s from "@/db/schema";
import { EMPTY_ITEM_FORM, EMPTY_SUPPLIER_FORM } from "@/lib/validation/inventory";

export async function invSetup(db: DB) {
  const [raw] = await db.select().from(s.invCategories).where(eq(s.invCategories.name, "Raw material"));
  const [ml] = await db.select().from(s.invUnits).where(eq(s.invUnits.name, "ml"));
  const [pcs] = await db.select().from(s.invUnits).where(eq(s.invUnits.name, "pcs"));
  const supplier = await createSupplier(db, { ...EMPTY_SUPPLIER_FORM, name: "Deccan Resins & Polymers", phone: "9822011111" });
  const other = await createSupplier(db, { ...EMPTY_SUPPLIER_FORM, name: "LabChem Supplies Pune" });
  const resin = await createItem(db, { ...EMPTY_ITEM_FORM, name: "SLA resin, imported (grey)", categoryId: raw.id, unitId: ml.id, reorderLevel: "1000", reorderQty: "3000", packName: "Bottle", packSize: "1000", trackBatches: true });
  const gloves = await createItem(db, { ...EMPTY_ITEM_FORM, name: "Nitrile gloves", categoryId: raw.id, unitId: pcs.id, reorderLevel: "100", reorderQty: "500", packName: "Box", packSize: "100" });
  const [team] = await db.insert(s.teamMembers).values({ name: "Priya Shah" }).returning();
  const purposes = await db.select().from(s.invPurposes);
  const reasons = await db.select().from(s.invAdjustReasons);
  return {
    supplier,
    other,
    resin,
    gloves,
    team,
    purpose: (n: string) => purposes.find((p) => p.name === n)!.id,
    reason: (n: string) => reasons.find((r) => r.name === n)!.id,
  };
}

export async function item(db: DB, id: string) {
  return (await db.select().from(s.invItems).where(eq(s.invItems.id, id)))[0];
}
