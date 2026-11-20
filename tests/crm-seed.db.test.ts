import { isNotNull } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@/db/schema";
import { loadCrmDemo } from "@/scripts/demo-crm";
import { freshDemoData, testDb } from "./helpers";

const skip = !!process.env.SKIP_DB_TESTS;
const { db, pool } = testDb();

describe.skipIf(skip)("crm:seed (database)", () => {
  beforeEach(async () => {
    await freshDemoData(db);
  });
  afterAll(async () => {
    await pool.end();
  });

  it("adds only CRM data: no new customers, no quotation links, no orders", async () => {
    const before = { customers: (await db.select().from(s.customers)).length, quotes: (await db.select().from(s.quotations)).length, tickets: (await db.select().from(s.tickets)).length };
    expect(await loadCrmDemo(db, { links: false })).toBe(12);
    expect((await db.select().from(s.customers)).length).toBe(before.customers);
    expect((await db.select().from(s.quotations)).length).toBe(before.quotes);
    expect((await db.select().from(s.tickets)).length).toBe(before.tickets);
    expect(await db.select().from(s.quotations).where(isNotNull(s.quotations.leadId))).toHaveLength(0);
    expect(await db.select().from(s.leads)).toHaveLength(12);
  });
});
