/**
 * npm run db:seed
 * Loads demo data into an EMPTY database only. It never deletes anything.
 * To wipe and reload, use: npm run db:reset
 */
import { isEmpty, loadDemoData, scriptDb } from "./demo-data";

async function main() {
  const { db, pool, where } = scriptDb();
  try {
    if (!(await isEmpty(db))) {
      console.log(`\nStopped: ${where} already has data, so nothing was changed.`);
      console.log("To wipe it and load clean demo data, run:  npm run db:reset\n");
      process.exitCode = 1;
      return;
    }
    console.log(`Loading demo data into ${where}...`);
    await loadDemoData(db);
    console.log("Done.");
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
