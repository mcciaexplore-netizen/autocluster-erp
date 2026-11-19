/**
 * Vitest global setup for database tests.
 * Builds a fresh LOCAL test database (acdri_test) from the current schema.
 * It never touches the database in .env.local.
 */
import { execSync } from "node:child_process";
import { Client } from "pg";

export const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? `postgres://${process.env.USER ?? "postgres"}@localhost:5432/acdri_test`;

export default async function setup() {
  const u = new URL(TEST_DB_URL);
  if (!["localhost", "127.0.0.1"].includes(u.hostname)) throw new Error("Database tests only run against a local test database.");
  const admin = new Client({ connectionString: `${u.protocol}//${u.username}${u.password ? ":" + u.password : ""}@${u.host}/postgres` });
  try {
    await admin.connect();
  } catch {
    console.warn("\n[db tests] No local Postgres found, database tests will be skipped.\n");
    process.env.SKIP_DB_TESTS = "1";
    return;
  }
  const name = u.pathname.slice(1);
  await admin.query(`drop database if exists "${name}" with (force)`);
  await admin.query(`create database "${name}"`);
  await admin.end();
  execSync("npx drizzle-kit push --force", {
    stdio: "ignore",
    env: { ...process.env, DATABASE_URL_UNPOOLED: TEST_DB_URL, DATABASE_URL: TEST_DB_URL },
  });
  process.env.TEST_DB_READY = TEST_DB_URL;
}
