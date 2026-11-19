/**
 * Uploaded files for scripts (db:reset).
 * Safety rule: we only ever delete files that are LISTED in the database being reset.
 * We never list or empty the whole store, so local and live files can't affect each other.
 */
import { del } from "@vercel/blob";
import type { DB, Tx } from "../db/client";
import { files } from "../db/schema";
import { blobAuth, blobConfigured } from "../lib/blob";
import { BLOB_ENVS } from "../lib/files";

/** Storage paths of every file this database knows about. */
export async function storedFilePaths(db: DB | Tx): Promise<string[]> {
  const rows = await db.select({ path: files.blobPath }).from(files);
  // Only our own folders (local/, preview/, live/); anything else is left alone.
  return [...new Set(rows.map((r) => r.path))].filter((p) => BLOB_ENVS.some((env) => p.startsWith(`${env}/`)));
}

/** Deletes exactly these files from Blob storage. Returns how many were asked to be deleted. */
export async function deleteStoredFiles(paths: string[]): Promise<{ deleted: number; skipped: string | null }> {
  if (!paths.length) return { deleted: 0, skipped: null };
  if (!blobConfigured()) return { deleted: 0, skipped: "BLOB_READ_WRITE_TOKEN is not set, so uploaded files were left in storage." };
  for (let i = 0; i < paths.length; i += 100) await del(paths.slice(i, i + 100), blobAuth());
  return { deleted: paths.length, skipped: null };
}
