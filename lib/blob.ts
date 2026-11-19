/**
 * Vercel Blob settings. All files are PRIVATE: they're only served through /api/files/[id]
 * after a sign-in check, and the raw storage link is never shown.
 *
 * Credentials: BLOB_READ_WRITE_TOKEN (needed for browser uploads). It is passed explicitly
 * so the library doesn't prefer Vercel's short-lived project sign-in, which only works on Vercel.
 * Plain module (no Next.js imports) so scripts like db:reset can use it too.
 */
import type { BlobEnv } from "./files";

export function blobToken(): string | undefined {
  return process.env.BLOB_READ_WRITE_TOKEN || undefined;
}

export function blobConfigured(): boolean {
  return !!blobToken();
}

/** Credentials for every @vercel/blob call. */
export function blobAuth() {
  const token = blobToken();
  return token ? { token } : {};
}

/** Which folder this copy of the app writes to. */
export function blobEnv(): BlobEnv {
  if (process.env.VERCEL_ENV === "production") return "live";
  if (process.env.VERCEL_ENV === "preview") return "preview";
  return "local";
}

export const BLOB_NOT_SET_MESSAGE = "File uploads aren't set up yet (BLOB_READ_WRITE_TOKEN is missing). Please ask the person who set up the app.";
