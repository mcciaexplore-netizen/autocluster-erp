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
    // Keeps long-running connections (e.g. db:reset on Neon) from being dropped as idle by the network.
    keepAlive: true,
  };
  if (!isLocal(connectionString) && !/[?&]sslmode=/.test(connectionString)) {
    config.ssl = true;
  }
  const pool = new Pool(config);
  // A connection that drops while idle must not crash the process; the next query gets a new one.
  pool.on("error", (e) => console.error(`Database connection dropped (${e.message}); it will reconnect.`));
  // Same for a connection that is in use (e.g. inside a transaction): its query fails with the
  // error (so the caller can retry), instead of the error event stopping the whole process.
  pool.on("connect", (client) => client.on("error", () => {}));
  return pool;
}

/** True for errors where the network link to the database dropped (worth trying again). */
export function isConnectionDrop(e: unknown): boolean {
  const err = e as { code?: string; message?: string; cause?: unknown };
  const text = `${err?.code ?? ""} ${err?.message ?? ""}`;
  if (/ECONNRESET|ETIMEDOUT|EPIPE|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|Connection terminated|terminating connection|connection timeout|Client has encountered a connection error|08006|08003|08001|57P01/i.test(text)) return true;
  return err?.cause ? isConnectionDrop(err.cause) : false;
}

export function createDb(pool: Pool) {
  return drizzle(pool, { schema });
}

export type DB = ReturnType<typeof createDb>;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
