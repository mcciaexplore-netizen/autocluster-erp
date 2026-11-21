/**
 * npm run jobs:backfill
 * Creates a job ("To plan") for every open ticket that doesn't have one yet. Safe to run many
 * times: tickets that already have a job are left alone.
 */
import { backfillJobs } from "../db/job-writer";
import { scriptDb } from "./demo-data";

async function main() {
  const { db, pool, where } = scriptDb();
  try {
    console.log(`Creating jobs for open tickets in ${where}...`);
    const r = await backfillJobs(db);
    console.log(r.created ? `Done: ${r.created} ${r.created === 1 ? "job" : "jobs"} created.` : "Nothing to do: every open ticket already has a job.");
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
