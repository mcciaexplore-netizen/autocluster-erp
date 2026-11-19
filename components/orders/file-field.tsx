"use client";

import { upload } from "@vercel/blob/client";
import { FileText, Loader2, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { registerUpload } from "@/lib/actions/orders";
import { FILE_ACCEPT, fileProblem, fileTypeOf, formatFileSize, uploadPath, type BlobEnv, type FileKindName, type UploadedFile } from "@/lib/files";
import { cn } from "@/lib/utils";

/**
 * Picks a PDF/JPG/PNG (up to 10 MB), uploads it straight to private storage,
 * then shows its name, size and a "View" link.
 */
export function FileField({
  id,
  kind,
  env,
  value,
  onChange,
  onBusyChange,
  invalid,
  describedBy,
}: {
  id: string;
  kind: FileKindName;
  env: BlobEnv;
  value: UploadedFile | null;
  onChange: (f: UploadedFile | null) => void;
  onBusyChange?: (busy: boolean) => void;
  invalid?: boolean;
  describedBy?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = progress !== null;

  async function pick(file: File) {
    setError(null);
    const problem = fileProblem(file);
    if (problem) return setError(problem);
    setProgress(0);
    onBusyChange?.(true);
    try {
      const blob = await upload(uploadPath(env, kind, file.name), file, {
        access: "private",
        handleUploadUrl: "/api/files/upload",
        contentType: fileTypeOf(file),
        onUploadProgress: (p) => setProgress(Math.round(p.percentage)),
      });
      const saved = await registerUpload({ pathname: blob.pathname, fileName: file.name, kind });
      if (!saved.ok) setError(saved.message);
      else onChange(saved.data);
    } catch (e) {
      console.error(e);
      setError("The upload didn't finish. Please check your internet and try again.");
    } finally {
      setProgress(null);
      onBusyChange?.(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={input}
        id={id}
        type="file"
        accept={FILE_ACCEPT}
        className="sr-only"
        aria-invalid={invalid || !!error}
        aria-describedby={describedBy}
        disabled={busy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void pick(f);
        }}
      />
      {value ? (
        <div className="flex items-center gap-3 rounded-xl border bg-muted/40 px-3 py-2.5">
          <FileText className="size-5 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{value.name}</p>
            <p className="text-xs text-muted-foreground">{formatFileSize(value.size)} · Uploaded</p>
          </div>
          <a href={`/api/files/${value.id}`} target="_blank" rel="noopener" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
            View
          </a>
          <Button type="button" variant="ghost" size="icon" className="size-8" onClick={() => onChange(null)} aria-label="Remove this file">
            <X className="size-4" aria-hidden />
          </Button>
        </div>
      ) : (
        <label
          htmlFor={id}
          className={cn(
            "flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border border-dashed px-3 py-3 text-sm transition-colors hover:bg-muted/50 focus-within:ring-2 focus-within:ring-ring",
            (invalid || error) && "border-destructive",
            busy && "cursor-wait opacity-80",
          )}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f && !busy) void pick(f);
          }}
        >
          {busy ? <Loader2 className="size-5 shrink-0 animate-spin text-primary" aria-hidden /> : <Upload className="size-5 shrink-0 text-primary" aria-hidden />}
          <span className="flex-1">
            {busy ? (
              <>Uploading… {progress}%</>
            ) : (
              <>
                <span className="font-medium text-primary">Choose a file</span> or drop it here
                <span className="block text-xs text-muted-foreground">PDF, JPG or PNG, up to 10 MB</span>
              </>
            )}
          </span>
        </label>
      )}
      {error ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
