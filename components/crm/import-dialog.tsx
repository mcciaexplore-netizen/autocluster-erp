"use client";

import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { importLeadsAction, previewImportAction, problemRowsAction, type PreviewRow } from "@/lib/actions/crm-import";
import { IMPORT_TOO_BIG, MAX_IMPORT_BYTES, MAX_IMPORT_ROWS } from "@/lib/crm/import";
import { cn } from "@/lib/utils";

type State =
  | { step: "choose" }
  | { step: "preview"; fileName: string; rows: PreviewRow[]; skippedExample: boolean }
  | { step: "done"; imported: number; leadNos: string[]; bad: PreviewRow[] };

/**
 * "Import enquiries": 1. download the template, 2. upload it filled in, 3. preview every row
 * (problems in plain words), 4. import the good rows; problem rows can be downloaded to fix.
 */
export function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ step: "choose" });
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) setTimeout(() => setState({ step: "choose" }), 200);
  };

  const upload = (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) return void toast.error(IMPORT_TOO_BIG);
    const form = new FormData();
    form.set("file", file);
    start(async () => {
      const r = await previewImportAction(form);
      if (fileRef.current) fileRef.current.value = "";
      if (!r.ok) return void toast.error(r.message);
      setState({ step: "preview", ...r.data });
    });
  };

  const downloadProblems = (rows: PreviewRow[]) =>
    start(async () => {
      const r = await problemRowsAction(rows.map((x) => ({ rowNo: x.rowNo, raw: x.raw })));
      if (!r.ok) return void toast.error(r.message);
      const bytes = Uint8Array.from(atob(r.data.base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = r.data.fileName;
      a.dataset.skipUnsaved = "";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    });

  const importGood = (s: Extract<State, { step: "preview" }>) =>
    start(async () => {
      const good = s.rows.filter((r) => r.ok);
      const r = await importLeadsAction(
        good.map((x) => ({ rowNo: x.rowNo, raw: x.raw })),
        s.fileName,
      );
      if (!r.ok) return void toast.error(r.message);
      toast.success(`${r.data.imported} ${r.data.imported === 1 ? "enquiry" : "enquiries"} imported`);
      router.refresh();
      setState({ step: "done", imported: r.data.imported, leadNos: r.data.leadNos, bad: s.rows.filter((x) => !x.ok) });
    });

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="size-5" aria-hidden /> Import enquiries
          </DialogTitle>
          <DialogDescription>Add many enquiries at once from an Excel file.</DialogDescription>
        </DialogHeader>

        {state.step === "choose" ? (
          <ol className="flex flex-col gap-4">
            <li className="rounded-xl border p-4">
              <p className="font-medium">1. Download the template</p>
              <p className="mb-3 text-sm text-muted-foreground">It has the right columns, an example row, and a “Lists” sheet with the sources, stages and team names to use.</p>
              <Button asChild variant="outline">
                <a href="/api/crm/import-template" download data-skip-unsaved>
                  <Download aria-hidden /> Download Excel template
                </a>
              </Button>
            </li>
            <li className="rounded-xl border p-4">
              <p className="font-medium">2. Upload the filled file</p>
              <p className="mb-3 text-sm text-muted-foreground">
                One enquiry per row, up to {MAX_IMPORT_ROWS} rows. Nothing is saved until you check the rows in the next step.
              </p>
              <input ref={fileRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" id="crm-import-file" onChange={(e) => upload(e.target.files?.[0])} />
              <Button asChild disabled={pending}>
                <label htmlFor="crm-import-file" className="cursor-pointer">
                  {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Upload aria-hidden />} Choose Excel file
                </label>
              </Button>
            </li>
          </ol>
        ) : null}

        {state.step === "preview" ? <Preview s={state} pending={pending} onImport={() => importGood(state)} onProblems={() => downloadProblems(state.rows.filter((r) => !r.ok))} onBack={() => setState({ step: "choose" })} /> : null}

        {state.step === "done" ? (
          <div className="flex flex-col gap-4">
            <p className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
              <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden />
              <span>
                {state.imported} {state.imported === 1 ? "enquiry was" : "enquiries were"} added to the board
                {state.leadNos.length ? ` (${state.leadNos[0]}${state.leadNos.length > 1 ? ` to ${state.leadNos.at(-1)}` : ""})` : ""}.
              </span>
            </p>
            {state.bad.length ? (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                <span className="flex-1">
                  {state.bad.length} {state.bad.length === 1 ? "row was" : "rows were"} not imported. Download {state.bad.length === 1 ? "it" : "them"}, fix the problems listed, and import the file again.
                </span>
                <Button size="sm" variant="outline" className="bg-white" disabled={pending} onClick={() => downloadProblems(state.bad)}>
                  <Download aria-hidden /> Download problem rows
                </Button>
              </div>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setState({ step: "choose" })}>
                Import another file
              </Button>
              <Button onClick={() => close(false)}>Done</Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Preview({ s, pending, onImport, onProblems, onBack }: { s: Extract<State, { step: "preview" }>; pending: boolean; onImport: () => void; onProblems: () => void; onBack: () => void }) {
  const good = s.rows.filter((r) => r.ok);
  const bad = s.rows.filter((r) => !r.ok);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm">
        <strong>{s.fileName}</strong>: {s.rows.length} {s.rows.length === 1 ? "row" : "rows"}.{" "}
        <span className="font-medium text-emerald-700">{good.length} ready to import</span>
        {bad.length ? (
          <>
            , <span className="font-medium text-red-700">{bad.length} with problems</span>
          </>
        ) : null}
        .{s.skippedExample ? " The example row was skipped." : ""}
      </p>

      {bad.length ? (
        <section aria-labelledby="bad-h" className="rounded-xl border border-red-200 bg-red-50/60 p-3">
          <h3 id="bad-h" className="mb-2 flex items-center gap-1.5 font-semibold text-red-800">
            <AlertCircle className="size-4" aria-hidden /> Rows with problems (not imported)
          </h3>
          <ul className="flex max-h-56 flex-col gap-2 overflow-y-auto text-sm">
            {bad.map((r) => (
              <li key={r.rowNo} className="rounded-lg bg-white p-2">
                <p className="font-medium">
                  Row {r.rowNo}
                  {r.title ? `: ${r.title}` : ""}
                  {r.company ? ` (${r.company})` : ""}
                </p>
                <ul className="list-disc pl-5 text-red-800">
                  {r.problems.map((p) => (
                    <li key={p}>{p.replace(/^Row \d+: /, "").replace(/^./, (c) => c.toUpperCase())}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {good.length ? (
        <section aria-labelledby="good-h" className="rounded-xl border p-3">
          <h3 id="good-h" className="mb-2 flex items-center gap-1.5 font-semibold text-emerald-800">
            <CheckCircle2 className="size-4" aria-hidden /> Ready to import
          </h3>
          <ul className="max-h-48 divide-y overflow-y-auto text-sm">
            {good.map((r) => (
              <li key={r.rowNo} className="flex flex-wrap items-baseline gap-x-2 py-1.5">
                <span className="w-14 shrink-0 text-muted-foreground tabular-nums">Row {r.rowNo}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{r.title}</span>
                <span className="truncate text-muted-foreground">{r.company}</span>
                <span className="rounded-full border px-2 text-xs">{r.stage}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className={cn("flex flex-wrap justify-end gap-2")}>
        <Button variant="ghost" onClick={onBack} disabled={pending}>
          Choose another file
        </Button>
        {bad.length ? (
          <Button variant="outline" onClick={onProblems} disabled={pending}>
            <Download aria-hidden /> Download problem rows
          </Button>
        ) : null}
        <Button onClick={onImport} disabled={pending || !good.length}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Upload aria-hidden />}
          {good.length ? `Import ${good.length} good ${good.length === 1 ? "row" : "rows"}` : "Nothing to import"}
        </Button>
      </div>
    </div>
  );
}
