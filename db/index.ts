/**
 * Database for the running app.
 *
 * Uses DATABASE_URL, which on Vercel is Neon's POOLED connection string.
 * The pool is kept small and stored on globalThis, so every request served by
 * the same serverless instance reuses it instead of opening new connections.
 * This uses the `pg` driver (not neon-http) because creating a quotation
 * number needs a real transaction.
 */
import { attachDatabasePool } from "@vercel/functions";
import type { Pool } from "pg";
import { createDb, createPool } from "./client";

export type { DB, Tx } from "./client";

const globalForDb = globalThis as unknown as { acdriPool?: Pool };

function getPool(): Pool {
  if (globalForDb.acdriPool) return globalForDb.acdriPool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Add it to .env.local (see README).");
  }
  const pool = createPool(connectionString, process.env.VERCEL ? 3 : 5);
  // On Vercel, closes idle connections cleanly before a function instance is suspended.
  if (process.env.VERCEL) attachDatabasePool(pool);
  globalForDb.acdriPool = pool;
  return pool;
}

export const pool = getPool();
export const db = createDb(pool);
