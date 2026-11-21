/**
 * npm run db:reset
 * Wipes ALL data (customers, quotations, tickets, rate card, settings) and reloads clean demo data.
 * Also deletes the uploaded files listed in THIS database (never anything else in the store).
 * Asks you to type RESET first.
 */
import { createInterface } from "node:readline/promises";
import { deleteStoredFiles, storedFilePaths } from "./blob-files";
import { loadDemoData, scriptDb, wipe } from "./demo-data";
import { scriptBlobFolder } from "./demo-orders";

async function main() {
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
    // One transaction: if anything fails, the old data stays as it was.
    const uploaded: string[] = [];
    const blobFolder = scriptBlobFolder(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL);
    try {
      await db.transaction(async (tx) => {
        console.log("Wiping data...");
        await wipe(tx);
        console.log("Loading demo data...");
        await loadDemoData(tx, { orders: { blobFolder, onUpload: (p) => uploaded.push(p) }, crm: true, inventory: true, planning: true });
      });
    } catch (e) {
      // Nothing was saved, so remove the sample PDFs this run uploaded.
      await deleteStoredFiles(uploaded).catch(() => {});
      throw e;
    }
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
  process.exit(1);
});
