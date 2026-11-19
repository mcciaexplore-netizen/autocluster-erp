import { createDb, createPool, type DB } from "@/db/client";
import { createQuotation } from "@/db/quote-writer";
import * as s from "@/db/schema";
import { loadDemoData, wipe } from "@/scripts/demo-data";
import { eq } from "drizzle-orm";

export const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? `postgres://${process.env.USER ?? "postgres"}@localhost:5432/acdri_test`;

export function testDb() {
  const pool = createPool(TEST_DB_URL, 12);
  return { db: createDb(pool), pool };
}

export async function freshDemoData(db: DB) {
  await db.transaction(async (tx) => {
    await wipe(tx);
    await loadDemoData(tx, { quiet: true });
  });
}

/** Creates a quotation for a demo customer with the named services. */
export async function makeQuote(db: DB, companyLike: string, lines: { name: string; q: { ccPerPart?: number; parts?: number; hours?: number; samples?: number } }[]) {
  const [c] = (await db.select().from(s.customers)).filter((x) => x.companyName.includes(companyLike));
  const svcs = await db.select().from(s.services);
  const today = "2026-11-19";
  return createQuotation(db, {
    customerId: c.id,
    quoteDate: today,
    validUntil: "2026-12-19",
    subject: "Test",
    notes: null,
    terms: "-",
    status: "SENT",
    lines: lines.map((l, i) => {
      const svc = svcs.find((x) => x.name === l.name)!;
      return { key: `k${i}`, serviceId: svc.id, deptCode: svc.deptCode, description: svc.name, unitType: svc.unitType, unitLabel: svc.unitLabel, customRatePaise: null, ...l.q };
    }),
  });
}

export async function ticketsOf(db: DB, quotationId: string) {
  return db.select().from(s.tickets).where(eq(s.tickets.quotationId, quotationId)).orderBy(s.tickets.seq);
}
