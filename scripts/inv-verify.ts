/**
 * npm run inv:verify
 * Recalculates all stock from the movements and reports any difference in plain words.
 * It only reads; it never changes anything.
 */
import { verifyInventory } from "../db/inv-verify";
import { scriptDb } from "./demo-data";

async function main() {
  const { db, pool, where } = scriptDb();
  try {
    console.log(`Checking stock in ${where}...`);
    const problems = await verifyInventory(db);
    if (!problems.length) {
      console.log("All good: every item, batch, running balance and value matches the stock movements.");
      return;
    }
    console.log(`${problems.length} difference(s) found:`);
    for (const p of problems) console.log(`  - ${p}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
