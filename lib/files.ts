/** Rules for uploaded files (PO copies, tax invoices). Safe to use in the browser and on the server. */

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
export const ALLOWED_FILE_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
export const FILE_ACCEPT = ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png";
export type FileKindName = "PO" | "INVOICE" | "BILL" | "JOB";

/** Storage sub-folder for each kind of file. */
export const KIND_FOLDER: Record<FileKindName, string> = { PO: "po", INVOICE: "invoice", BILL: "bill", JOB: "job" };

/** Blob folders. `local`, `preview` and `live` keep each environment's files apart. */
export const BLOB_ENVS = ["local", "preview", "live"] as const;
export type BlobEnv = (typeof BLOB_ENVS)[number];

export interface UploadedFile {
  id: string;
  name: string;
  size: number;
}

/** Guesses the type from the name when the browser leaves it blank. */
export function fileTypeOf(file: { name: string; type: string }): string {
  if (file.type) return file.type === "image/jpg" ? "image/jpeg" : file.type;
  const ext = file.name.toLowerCase().split(".").pop();
  return ext === "pdf" ? "application/pdf" : ext === "png" ? "image/png" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "";
}

/** A friendly reason the file can't be used, or null when it's fine. */
export function fileProblem(file: { name: string; type: string; size: number }): string | null {
  if (!(ALLOWED_FILE_TYPES as readonly string[]).includes(fileTypeOf(file))) return "Please choose a PDF, JPG or PNG file.";
  if (file.size > MAX_FILE_BYTES) return `This file is ${formatFileSize(file.size)}. Please choose one up to 10 MB.`;
  if (file.size === 0) return "This file is empty. Please choose another one.";
  return null;
}

/** 1536 -> "1.5 KB", 2_400_000 -> "2.3 MB" */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Keeps letters, digits, dot, dash and underscore so the storage path stays tidy. */
export function safeFileName(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+/, "")
    .slice(-80);
  return cleaned || "file";
}

/** Storage path for a new upload, e.g. local/po/PO-123.pdf (Blob adds a random suffix). */
export function uploadPath(env: BlobEnv, kind: FileKindName, fileName: string): string {
  return `${env}/${KIND_FOLDER[kind]}/${safeFileName(fileName)}`;
}

/** Checks a path the browser asks to upload to. */
export function isValidUploadPath(path: string, env: BlobEnv): boolean {
  return new RegExp(`^${env}/(po|invoice|bill|job)/[\\w.-]{1,140}$`).test(path) && !path.includes("..");
}
