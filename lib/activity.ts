/**
 * The Activity log (section 5.4): one central helper every server action uses. Who did it comes
 * from the signed-in person; "on behalf of" when they recorded work for someone else.
 * Never throws: a log entry that can't be written must not undo the work itself.
 */
import { headers } from "next/headers";
import { db } from "@/db";
import type { DB, Tx } from "@/db/client";
import { activityLog } from "@/db/schema";
import { currentActor } from "@/lib/auth/actor";

export type ActivityArea = "Users" | "Roles" | "Sign-in" | "Settings" | "CRM" | "Customers" | "Quotations" | "Orders" | "Planning" | "Inventory" | "Rate Card";

export interface ActivityEntry {
  area: ActivityArea;
  /** Short verb, e.g. "created", "changed", "deactivated", "payment". */
  action: string;
  summary: string;
  entityType?: string | null;
  entityId?: string | null;
  data?: Record<string, unknown> | null;
  /** app_users.id of the person the work was recorded for (when not the signed-in person). */
  onBehalfOfUserId?: string | null;
  /** Override who did it (e.g. failed sign-ins, where nobody is signed in). */
  userId?: string | null;
}

async function requestInfo(): Promise<{ ip: string | null; userAgent: string | null }> {
  try {
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
    return { ip, userAgent: h.get("user-agent") };
  } catch {
    return { ip: null, userAgent: null }; // outside a request (scripts, tests)
  }
}

export async function logActivity(e: ActivityEntry, conn: DB | Tx = db) {
  try {
    const actor = e.userId !== undefined ? null : await currentActor();
    const { ip, userAgent } = await requestInfo();
    await conn.insert(activityLog).values({
      userId: e.userId !== undefined ? e.userId : (actor?.userId ?? null),
      onBehalfOfUserId: e.onBehalfOfUserId ?? null,
      area: e.area,
      action: e.action,
      entityType: e.entityType ?? null,
      entityId: e.entityId ?? null,
      summary: e.summary,
      data: e.data ?? null,
      ip,
      userAgent,
    });
  } catch (err) {
    console.error("activity log", err);
  }
}
