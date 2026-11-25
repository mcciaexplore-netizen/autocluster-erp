/**
 * npm run db:seed
 * Loads demo data (incl. Orders & Billing with sample PDFs) into an EMPTY database only. It never deletes anything.
 * To wipe and reload, use: npm run db:reset
 */
import { setUpDemoUsers } from "../db/demo-users";
import { createAuth } from "../lib/auth/better-auth";
import { isDemoMode, NOT_DEMO_MESSAGE } from "../lib/auth/demo-mode";
import { isConnectionDrop } from "../db/client";
import { isEmpty, loadDemoData, scriptDb } from "./demo-data";
import { clearStagedFiles, uploadStagedFiles } from "./demo-files";
import { scriptBlobFolder } from "./demo-orders";

async function main() {
  // Real use (DEMO_MODE not true): never wipe or load demo data.
  if (!isDemoMode()) {
    console.log(`\n${NOT_DEMO_MESSAGE}\n`);
    process.exitCode = 1;
    return;
  }
  const { db, pool, where } = scriptDb();
  try {
    if (!(await isEmpty(db))) {
      console.log(`\nStopped: ${where} already has data, so nothing was changed.`);
      console.log("To wipe it and load clean demo data, run:  npm run db:reset\n");
      process.exitCode = 1;
      return;
    }
    console.log(`Loading demo data into ${where}...`);
    const blobFolder = scriptBlobFolder(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL);
    // Same as db:reset: retry the database part if the link drops; upload files only once it has saved.
    for (let attempt = 1; ; attempt++) {
      clearStagedFiles();
      try {
        await db.transaction((tx) => loadDemoData(tx, { orders: { blobFolder }, crm: true, inventory: true, planning: true }));
        break;
      } catch (e) {
        if (attempt < 3 && isConnectionDrop(e)) {
          console.log(`The link to the database dropped; nothing was saved. Trying again (${attempt + 1} of 3)...`);
          await new Promise((r) => setTimeout(r, 5000 * attempt));
          continue;
        }
        throw e;
      }
    }
    console.log("Adding the demo users...");
    await setUpDemoUsers(db, createAuth(db), { log: (m) => console.log(m) });
    const up = await uploadStagedFiles((m) => console.log(m));
    if (!up.skipped) console.log(`Uploaded ${up.uploaded} sample PDF(s).${up.failed.length ? ` ${up.failed.length} could not be uploaded.` : ""}`);
    console.log("Done.");
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
