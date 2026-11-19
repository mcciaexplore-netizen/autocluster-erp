/**
 * npm run tickets:backfill
 * Opens tickets for quotations that are already Accepted but have none yet.
 * Safe to run any number of times: it never creates a second ticket for a line.
 */
import { backfillTickets } from "../db/ticket-writer";
import { todayInIndia } from "../lib/tickets";
import { scriptDb } from "./demo-data";

async function main() {
  const { db, pool, where } = scriptDb();
  try {
    console.log(`Checking Accepted quotations in ${where}...`);
    const results = await backfillTickets(db, todayInIndia());
    if (!results.length) console.log("No Accepted quotations found.");
    for (const r of results) {
      console.log(`  ${r.quoteNo}: ${r.opened.length ? `opened ${r.opened.join(", ")}` : "already has its tickets"}`);
    }
    console.log("Done.");
  } finally {
    await pool.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
