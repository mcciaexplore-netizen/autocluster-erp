/**
 * Sample files for the demo (db:seed / db:reset), uploaded only AFTER the database part has saved.
 *
 * While the demo data is written, each sample PDF is only "staged": it gets its final storage path
 * (with a random suffix, as uploads normally have) and its bytes are kept in memory. If the database
 * part fails, nothing was uploaded, so nothing is left behind. Once it has saved, the files are
 * uploaded to exactly those paths, each retried a few times.
 */
import { randomBytes } from "node:crypto";
import { del, put } from "@vercel/blob";
import { blobAuth, blobConfigured } from "../lib/blob";
import { uploadPath, type BlobEnv, type FileKindName } from "../lib/files";

type Staged = { path: string; bytes: Uint8Array; contentType: string };
const g = globalThis as unknown as { acdriStagedFiles?: Staged[] };
const staged = (g.acdriStagedFiles ??= []);

const suffix = () => randomBytes(24).toString("base64url").replace(/[^A-Za-z0-9]/g, "").slice(0, 30);

/** Gives a sample file its storage path and keeps it for uploading later. Returns the path. */
export function stageDemoFile(folder: BlobEnv, kind: FileKindName, fileName: string, bytes: Uint8Array, contentType = "application/pdf"): string {
  const base = uploadPath(folder, kind, fileName);
  const path = base.replace(/(\.[A-Za-z0-9]+)?$/, (ext) => `-${suffix()}${ext}`);
  staged.push({ path, bytes, contentType });
  return path;
}

/** Forget anything staged (e.g. before retrying a failed database part). */
export function clearStagedFiles() {
  staged.length = 0;
}

export function stagedCount() {
  return staged.length;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Uploads every staged file (4 at a time, each tried up to 4 times). Returns the paths that could
 * not be uploaded. Without a storage token, nothing is uploaded and the paths stay as records only.
 */
export async function uploadStagedFiles(log: (m: string) => void = () => {}): Promise<{ uploaded: number; failed: string[]; skipped: boolean }> {
  const todo = staged.splice(0);
  if (!todo.length || !blobConfigured()) return { uploaded: 0, failed: [], skipped: !!todo.length };
  const failed: string[] = [];
  let uploaded = 0;
  let next = 0;
  async function worker() {
    while (next < todo.length) {
      const f = todo[next++];
      for (let attempt = 1; ; attempt++) {
        try {
          await put(f.path, Buffer.from(f.bytes), { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: f.contentType, ...blobAuth() });
          uploaded++;
          break;
        } catch (e) {
          if (attempt >= 4) {
            failed.push(f.path);
            log(`  Could not upload ${f.path}: ${e instanceof Error ? e.message : e}`);
            break;
          }
          await pause(1000 * attempt);
        }
      }
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  return { uploaded, failed, skipped: false };
}

/** Deletes files this run uploaded (used only if a later step fails). */
export async function deleteUploaded(paths: string[]) {
  if (!paths.length || !blobConfigured()) return;
  for (let i = 0; i < paths.length; i += 100) await del(paths.slice(i, i + 100), blobAuth()).catch(() => {});
}
