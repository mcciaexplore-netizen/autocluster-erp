/**
 * npm run db:reset
 * Wipes ALL data (customers, quotations, rate card, settings) and reloads clean demo data.
 * Asks you to type RESET first.
 */
import { createInterface } from "node:readline/promises";
import { loadDemoData, scriptDb, wipe } from "./demo-data";

async function main() {
  const { db, pool, where } = scriptDb();
  try {
    console.log(`\nThis will DELETE every customer, quotation and setting in ${where}`);
    console.log("and load clean demo data instead. This cannot be undone.\n");
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question("Type RESET to continue: ")).trim();
    rl.close();
    if (answer !== "RESET") {
      console.log("Cancelled. Nothing was changed.");
      process.exitCode = 1;
      return;
    }
    // One transaction: if anything fails, the old data stays as it was.
    await db.transaction(async (tx) => {
      console.log("Wiping data...");
      await wipe(tx);
      console.log("Loading demo data...");
      await loadDemoData(tx);
    });
    console.log("Done. The database now holds clean demo data.");
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
