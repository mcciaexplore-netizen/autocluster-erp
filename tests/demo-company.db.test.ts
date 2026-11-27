import { asc } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import * as s from "@/db/schema";
import { loadDemoData, wipe } from "@/scripts/demo-data";
import { demoCompany } from "@/scripts/demo-company";
import { testDb } from "./helpers";

const skip = !!process.env.SKIP_DB_TESTS;
const { db, pool } = testDb();
afterAll(async () => {
  await pool.end();
});

async function load(company?: "generic" | "acdri") {
  await db.transaction(async (tx) => {
    await wipe(tx);
    await loadDemoData(tx, { quiet: true, company });
  });
  const [set] = await db.select().from(s.settings);
  const quotes = await db.select({ quoteNo: s.quotations.quoteNo }).from(s.quotations).orderBy(asc(s.quotations.quoteNo));
  const services = await db.select({ name: s.services.name, rate: s.services.rateMsme }).from(s.services).orderBy(asc(s.services.sortOrder));
  return { set, quotes, services };
}

describe("DEMO_COMPANY", () => {
  it("is generic unless set to acdri; anything else stops", () => {
    expect(demoCompany(undefined)).toBe("generic");
    expect(demoCompany("")).toBe("generic");
    expect(demoCompany("ACDRI")).toBe("acdri");
    expect(() => demoCompany("mccia")).toThrow('DEMO_COMPANY must be "generic" or "acdri"');
  });
});

describe.skipIf(skip)("demo company profiles (database)", () => {
  it("generic and acdri differ only in the company profile and numbers; the rate card is the same", async () => {
    const g = await load("generic");
    expect(g.set).toMatchObject({ orgName: "Demo Manufacturing Co., Pune", showOrgName: false, quotePrefix: "DMC/QT", ticketPrefix: "DMC/TK" });
    expect(g.quotes.every((q) => q.quoteNo.startsWith("DMC/QT/"))).toBe(true);
    const a = await load("acdri");
    expect(a.set).toMatchObject({ orgName: "Auto Cluster Development and Research Institute (ACDRI)", showOrgName: true, quotePrefix: "ACDRI/QT", ticketPrefix: "ACDRI/TK", leadPrefix: "ACDRI/EN" });
    expect(a.quotes.map((q) => q.quoteNo)).toEqual(g.quotes.map((q) => q.quoteNo.replace("DMC/", "ACDRI/")));
    expect(a.services).toEqual(g.services);
    expect(a.set.defaultTerms).toBe(g.set.defaultTerms);
  }, 120_000);
});
