/**
 * npm run db:seed
 * Loads demo data (incl. Orders & Billing with sample PDFs) into an EMPTY database only. It never deletes anything.
 * To wipe and reload, use: npm run db:reset
 */
import { deleteStoredFiles } from "./blob-files";
import { isEmpty, loadDemoData, scriptDb } from "./demo-data";
import { scriptBlobFolder } from "./demo-orders";

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
    const uploaded: string[] = [];
    const blobFolder = scriptBlobFolder(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL);
    try {
      await db.transaction((tx) => loadDemoData(tx, { orders: { blobFolder, onUpload: (p) => uploaded.push(p) } }));
    } catch (e) {
      await deleteStoredFiles(uploaded).catch(() => {});
      throw e;
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
