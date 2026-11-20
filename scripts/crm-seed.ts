/**
 * npm run crm:seed
 * Adds ONLY the CRM demo data (default stages and lists, 3 team members, 12 enquiries),
 * and only if there are no enquiries yet. It never changes customers, quotations or orders.
 */
import { sql } from "drizzle-orm";
import { scriptDb } from "./demo-data";
import { loadCrmDemo } from "./demo-crm";

async function main() {
  const { db, pool, where } = scriptDb();
  try {
    const n = Number((await db.execute<{ n: string }>(sql`select count(*) as n from leads`)).rows[0].n);
    if (n > 0) {
      console.log(`\nStopped: ${where} already has ${n} ${n === 1 ? "enquiry" : "enquiries"}, so nothing was changed.\n`);
      process.exitCode = 1;
      return;
    }
    const [{ s }] = (await db.execute<{ s: string }>(sql`select count(*) as s from settings`)).rows;
    if (Number(s) === 0) {
      console.log(`\nStopped: ${where} has no settings yet. Run npm run db:seed first.\n`);
      process.exitCode = 1;
      return;
    }
    console.log(`Adding the CRM demo to ${where}...`);
    const count = await loadCrmDemo(db, { links: false, log: (m) => console.log(m) });
    console.log(`Done. ${count} enquiries added.`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
