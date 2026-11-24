"use server";

import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { allow } from "@/lib/auth/guard";
import type { Permission } from "@/lib/auth/permissions";

export type LiveScope = "crm" | "orders" | "inventory";

const LIVE_PERMS: Record<string, Permission> = { crm: "crm.view", orders: "orders.view", inventory: "inventory.view" };

/**
 * "Has anything changed since X?" for the auto-refresh. A few EXISTS checks that stop at the
 * first match, so it stays tiny however much data there is. X is the database time returned
 * by the previous check (the browser's clock is never used).
 */
export async function changedSinceAction(scope: LiveScope, since: string | null): Promise<{ changed: boolean; at: string } | null> {
  const g = await allow(LIVE_PERMS[scope] ?? "orders.view");
  if (!g.ok) return null;
  const s = z.enum(["crm", "orders", "inventory"]).parse(scope);
  const t = since && !Number.isNaN(Date.parse(since)) ? new Date(since) : null;
  if (!t) {
    const r = await db.execute<{ at: string }>(sql`select now()::text as at`);
    return { changed: false, at: r.rows[0].at };
  }
  const query =
    s === "crm"
      ? sql`select now()::text as at,
          exists(select 1 from lead_events where created_at > ${t})
          or exists(select 1 from crm_stage_changes where created_at > ${t})
          or exists(select 1 from leads where updated_at > ${t}) as changed`
      : s === "orders"
        ? sql`select now()::text as at,
          exists(select 1 from ticket_events where created_at > ${t})
          or exists(select 1 from tickets where updated_at > ${t}) as changed`
        : sql`select now()::text as at,
          exists(select 1 from inv_documents where created_at > ${t})
          or exists(select 1 from inv_items where updated_at > ${t})
          or exists(select 1 from inv_suppliers where updated_at > ${t})
          or exists(select 1 from inv_counts where started_at > ${t} or completed_at > ${t})
          or exists(select 1 from inv_count_lines where counted_at > ${t}) as changed`;
  const r = await db.execute<{ at: string; changed: boolean }>(query);
  return { changed: !!r.rows[0].changed, at: r.rows[0].at };
}
