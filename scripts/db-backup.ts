/**
 * npm run db:backup
 * Saves every table of the database in .env.local to backups/<host>-<time>.json.
 * Read-only: it never changes the database.
 */
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { scriptDb } from "./demo-data";

async function main() {
  const { db, pool, where } = scriptDb();
  try {
    const tables = await db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`,
    );
    const out: Record<string, unknown[]> = {};
    for (const { table_name } of tables.rows) {
      const rows = await db.execute(sql.raw(`select * from "${table_name.replace(/"/g, "")}"`));
      out[table_name] = rows.rows;
    }
    const host = where.replace(/^.*(LOCAL|at )/, "").replace(/[^a-z0-9.]+/gi, "-").replace(/^-|-$/g, "") || "local";
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.mkdirSync("backups", { recursive: true });
    const file = path.join("backups", `${host}-${stamp}.json`);
    fs.writeFileSync(file, JSON.stringify({ takenAt: new Date().toISOString(), tables: out }, null, 1));
    console.log(`Backed up ${where}: ${Object.entries(out).map(([t, r]) => `${t} ${r.length}`).join(", ")}`);
    console.log(`Saved to ${file}`);
  } finally {
    await pool.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
