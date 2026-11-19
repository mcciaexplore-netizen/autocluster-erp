import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";
import * as schema from "./schema";

function isLocal(connectionString: string) {
  try {
    const host = new URL(connectionString).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "";
  } catch {
    return false;
  }
}

/**
 * A small Postgres pool.
 * - Neon (or any remote database): SSL is always on.
 * - Local Postgres: no SSL, so development keeps working.
 */
export function createPool(connectionString: string, max: number): Pool {
  // The pg driver already treats "require" as full certificate checking; say so explicitly
  // (this also silences its warning). Neon's certificates pass full checking.
  connectionString = connectionString.replace(/([?&]sslmode=)(require|prefer|verify-ca)\b/, "$1verify-full");
  const config: PoolConfig = {
    connectionString,
    max,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 15_000,
  };
  if (!isLocal(connectionString) && !/[?&]sslmode=/.test(connectionString)) {
    config.ssl = true;
  }
  return new Pool(config);
}

export function createDb(pool: Pool) {
  return drizzle(pool, { schema });
}

export type DB = ReturnType<typeof createDb>;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
