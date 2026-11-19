/**
 * Database for the running app.
 *
 * Uses DATABASE_URL, which on Vercel is Neon's POOLED connection string.
 * The pool is kept small and stored on globalThis, so every request served by
 * the same serverless instance reuses it instead of opening new connections.
 * This uses the `pg` driver (not neon-http) because creating a quotation
 * number needs a real transaction.
 *
 * The connection is created on FIRST USE, not when this file is loaded.
 * `next build` loads every page's code, and the build must not need a database.
 */
import { attachDatabasePool } from "@vercel/functions";
import type { Pool } from "pg";
import { createDb, createPool, type DB } from "./client";

export type { DB, Tx } from "./client";

const globalForDb = globalThis as unknown as { acdriPool?: Pool; acdriDb?: DB };

function getDb(): DB {
  if (globalForDb.acdriDb) return globalForDb.acdriDb;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Locally: add it to .env.local (see README). On Vercel: add it under Settings > Environment Variables, then redeploy.",
    );
  }
  const pool = createPool(connectionString, process.env.VERCEL ? 3 : 5);
  // On Vercel, closes idle connections cleanly before a function instance is suspended.
  if (process.env.VERCEL) attachDatabasePool(pool);
  globalForDb.acdriPool = pool;
  globalForDb.acdriDb = createDb(pool);
  return globalForDb.acdriDb;
}

/** Same object as a normal Drizzle database; it just connects the first time it is used. */
export const db: DB = new Proxy({} as DB, {
  get(_target, prop) {
    const real = getDb();
    const value = Reflect.get(real, prop, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
});
