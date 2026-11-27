/**
 * Records kept: the nightly clean-up removes only entries older than the settings, in batches,
 * writes one summary line, and the cron route refuses anyone without Vercel's cron secret.
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as s from "@/db/schema";
import { isVercelCron } from "@/lib/cron-auth";
import { BATCH, cleanUpOldEntries, cleanUpSummary, monthsBefore } from "@/lib/retention";
import { loadDemoData, wipe } from "@/scripts/demo-data";
import { testDb } from "./helpers";

const skip = !!process.env.SKIP_DB_TESTS;
const { db, pool } = testDb();
vi.mock("@/db", () => ({ db }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const SECRET = "a-long-test-cron-secret-0123456789";
const cron = (auth?: string) => new Request("https://example.com/api/cron/clean-up", { headers: auth ? { authorization: auth } : {} });

describe("cron secret", () => {
  it("only Vercel's cron gets in", () => {
    expect(isVercelCron(cron(`Bearer ${SECRET}`), SECRET)).toBe(true);
    expect(isVercelCron(cron(), SECRET)).toBe(false);
    expect(isVercelCron(cron(`Bearer ${SECRET}x`), SECRET)).toBe(false);
    expect(isVercelCron(cron(SECRET), SECRET)).toBe(false);
    expect(isVercelCron(cron("Bearer undefined"), undefined)).toBe(false); // no secret set up: nobody
    expect(isVercelCron(cron("Bearer short"), "short")).toBe(false);
  });
});

describe.skipIf(skip)("nightly clean-up (database)", () => {
  const now = new Date("2026-11-25T21:00:00Z");
  beforeAll(async () => {
    await db.transaction(async (tx) => {
      await wipe(tx);
      await loadDemoData(tx, { quiet: true });
    });
    await db.delete(s.activityLog);
    await db.delete(s.signInAttempts);
  }, 120_000);
  afterAll(() => pool.end());

  it("removes only entries older than the settings, in batches, and says how many", async () => {
    await db.update(s.settings).set({ activityKeepMonths: 24, signInKeepDays: 90 }).where(eq(s.settings.id, 1));
    const old = new Date(monthsBefore(now, 24).getTime() - 86_400_000);
    const recent = new Date(monthsBefore(now, 24).getTime() + 86_400_000);
    const n = BATCH * 2 + 17; // more than one batch
    await db.execute(sql`insert into activity_log (area, action, summary, created_at) select 'CRM', 'note', 'old ' || g, ${old} from generate_series(1, ${n}) g`);
    await db.insert(s.activityLog).values({ area: "CRM", action: "note", summary: "recent", createdAt: recent });
    await db.insert(s.signInAttempts).values([
      { email: "a@example.com", success: false, reason: "wrong_password", createdAt: new Date(now.getTime() - 91 * 86_400_000) },
      { email: "a@example.com", success: true, createdAt: new Date(now.getTime() - 89 * 86_400_000) },
    ]);
    const r = await cleanUpOldEntries(db, now);
    expect(r).toEqual({ activityRemoved: n, attemptsRemoved: 1, months: 24, days: 90, finished: true });
    expect((await db.select().from(s.activityLog)).map((x) => x.summary)).toEqual(["recent"]);
    expect(await db.select().from(s.signInAttempts)).toHaveLength(1);
    expect(cleanUpSummary(r)).toBe("Removed 4,017 entries older than 24 months, and 1 sign-in attempt older than 90 days.");
    expect(cleanUpSummary({ ...r, activityRemoved: 0, attemptsRemoved: 0 })).toBeNull();
  });

  it("follows the settings", async () => {
    await db.update(s.settings).set({ activityKeepMonths: 3 }).where(eq(s.settings.id, 1));
    const r = await cleanUpOldEntries(db, now); // the "recent" entry is older than 3 months
    expect(r.activityRemoved).toBe(1);
    await db.update(s.settings).set({ activityKeepMonths: 24 }).where(eq(s.settings.id, 1));
  });

  it("the cron route refuses without the secret, and logs one summary line with it", async () => {
    const { GET } = await import("@/app/api/cron/clean-up/route");
    process.env.CRON_SECRET = SECRET;
    expect((await GET(cron())).status).toBe(401);
    expect((await GET(cron("Bearer wrong-secret-wrong-secret-xx"))).status).toBe(401);
    await db.delete(s.signInAttempts); // the earlier test's attempts are dated from a fixed day, so by now they may be old too
    const old = new Date(monthsBefore(new Date(), 24).getTime() - 86_400_000);
    await db.insert(s.activityLog).values([1, 2, 3].map((i) => ({ area: "CRM", action: "note", summary: `old ${i}`, createdAt: old })));
    const res = await GET(cron(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, activityRemoved: 3 });
    const lines = await db.select().from(s.activityLog).where(eq(s.activityLog.action, "clean-up"));
    expect(lines.map((l) => [l.summary, l.userId])).toEqual([["Removed 3 entries older than 24 months.", null]]);
    delete process.env.CRON_SECRET;
  });

  it("entries stay small: long summaries are shortened and big details are dropped", async () => {
    const { smallEntry, MAX_SUMMARY } = await import("@/lib/activity");
    const e = smallEntry("x".repeat(5000), { copy: "y".repeat(5000) });
    expect(e.summary.length).toBe(MAX_SUMMARY);
    expect(e.data).toBeNull();
    expect(smallEntry("ok", { changed: ["rate"] })).toEqual({ summary: "ok", data: { changed: ["rate"] } });
  });
});
