/**
 * Nightly clean-up (vercel.json: 21:00 UTC = 2:30 am India time): removes Activity log entries and
 * sign-in attempts older than Settings > General > Records kept. Only Vercel's cron may call it.
 */
import { db } from "@/db";
import { logActivity } from "@/lib/activity";
import { isVercelCron } from "@/lib/cron-auth";
import { cleanUpOldEntries, cleanUpSummary } from "@/lib/retention";

export async function GET(request: Request) {
  if (!isVercelCron(request)) return Response.json({ error: "Not allowed." }, { status: 401 });
  const r = await cleanUpOldEntries(db, new Date());
  const summary = cleanUpSummary(r);
  if (summary) await logActivity({ area: "Settings", action: "clean-up", summary, entityType: "settings", entityId: null, userId: null });
  return Response.json({ ok: true, ...r }, { headers: { "Cache-Control": "no-store" } });
}
