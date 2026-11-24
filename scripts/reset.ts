/**
 * npm run db:reset
 * Wipes ALL data (customers, quotations, tickets, rate card, settings) and reloads clean demo data.
 * Only for demo databases (DEMO_MODE=true). Asks you to type RESET first.
 *
 * Sturdy on purpose:
 * 1. The database part runs in one transaction. If the link to the database drops, it is tried
 *    again from the start (up to 3 times). If it fails, the old data stays exactly as it was.
 * 2. Sample PDFs are uploaded only after the new data has saved, so a failed run leaves no files.
 * 3. Only then are the old files (listed in THIS database) deleted.
 */
import { createInterface } from "node:readline/promises";
import { isConnectionDrop } from "../db/client";
import { isDemoMode, NOT_DEMO_MESSAGE } from "../lib/auth/demo-mode";
import { deleteStoredFiles, storedFilePaths } from "./blob-files";
import { loadDemoData, scriptDb, wipe } from "./demo-data";
import { clearStagedFiles, uploadStagedFiles } from "./demo-files";
import { scriptBlobFolder } from "./demo-orders";

const TRIES = 3;

async function main() {
  // Real use (DEMO_MODE not true): never wipe or load demo data.
  if (!isDemoMode()) {
    console.log(`\n${NOT_DEMO_MESSAGE}\n`);
    process.exitCode = 1;
    return;
  }
  const { db, pool, where } = scriptDb();
  try {
    console.log(`\nThis will DELETE every customer, quotation, order, uploaded file and setting in ${where}`);
    console.log("and load clean demo data instead. This cannot be undone.\n");
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question("Type RESET to continue: ")).trim();
    rl.close();
    if (answer !== "RESET") {
      console.log("Cancelled. Nothing was changed.");
      process.exitCode = 1;
      return;
    }
    // Note the files this database knows about before wiping it.
    const oldFiles = await storedFilePaths(db);
    const blobFolder = scriptBlobFolder(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL);
    for (let attempt = 1; ; attempt++) {
      clearStagedFiles();
      try {
        await db.transaction(async (tx) => {
          console.log("Wiping data...");
          await wipe(tx);
          console.log("Loading demo data...");
          await loadDemoData(tx, { orders: { blobFolder }, crm: true, inventory: true, planning: true });
        });
        break;
      } catch (e) {
        if (attempt < TRIES && isConnectionDrop(e)) {
          console.log(`\nThe link to the database dropped (${e instanceof Error ? e.message : e}). Nothing was saved; trying again (${attempt + 1} of ${TRIES})...\n`);
          await new Promise((r) => setTimeout(r, 5000 * attempt));
          continue;
        }
        throw e;
      }
    }
    console.log("Demo data saved. Uploading the sample PDFs...");
    const up = await uploadStagedFiles((m) => console.log(m));
    if (up.skipped) console.log("BLOB_READ_WRITE_TOKEN is not set, so the sample PDFs were recorded but not uploaded.");
    else console.log(`Uploaded ${up.uploaded} sample PDF(s).`);
    if (up.failed.length) console.log(`${up.failed.length} sample PDF(s) could not be uploaded; those documents will show as missing. Run db:reset again to fix.`);
    // Only after the new data is safely saved: delete the old uploaded files.
    const r = await deleteStoredFiles(oldFiles);
    if (r.skipped) console.log(r.skipped);
    else if (r.deleted) console.log(`Deleted ${r.deleted} old uploaded file(s) that belonged to this database.`);
    console.log("Done. The database now holds clean demo data.");
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  console.error("\nThe reset did not finish. The database was left as it was, and no new files were uploaded.");
  process.exit(1);
});
