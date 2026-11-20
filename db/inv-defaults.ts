/**
 * Default Inventory lists. Each list is only filled when it is empty, so running this again
 * (or on live) never overwrites what staff have changed. Kept free of Next.js imports.
 */
import { sql } from "drizzle-orm";
import { DEFAULT_INV_CATEGORIES, DEFAULT_INV_PURPOSES, DEFAULT_INV_REASONS, DEFAULT_INV_UNITS } from "../lib/inventory/defaults";
import type { DB, Tx } from "./client";
import { invAdjustReasons, invCategories, invPurposes, invUnits } from "./schema";

export async function ensureInventoryDefaults(db: DB | Tx): Promise<string[]> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(4242101)`);
    const added: string[] = [];
    const lists = [
      ["inv_categories", invCategories, DEFAULT_INV_CATEGORIES, "categories"],
      ["inv_units", invUnits, DEFAULT_INV_UNITS, "units"],
      ["inv_purposes", invPurposes, DEFAULT_INV_PURPOSES, "internal use purposes"],
      ["inv_adjust_reasons", invAdjustReasons, DEFAULT_INV_REASONS, "adjustment reasons"],
    ] as const;
    for (const [name, table, values, label] of lists) {
      const n = Number((await tx.execute<{ n: string }>(sql`select count(*) as n from ${sql.identifier(name)}`)).rows[0].n);
      if (n === 0) {
        await tx.insert(table).values(values.map((v, i) => ({ name: v, sortOrder: i + 1 })));
        added.push(label);
      }
    }
    return added;
  });
}
