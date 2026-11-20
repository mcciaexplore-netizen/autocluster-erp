"use client";

import { AlertCircle, CheckCircle2, Download, Loader2, Upload } from "lucide-react";
import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Field } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { importItemsAction, itemProblemRowsAction, previewItemImportAction, type ItemPreviewRow } from "@/lib/actions/inv-import";
import { IMPORT_TOO_BIG, MAX_IMPORT_BYTES } from "@/lib/crm/import";
import { MAX_ITEM_IMPORT_ROWS } from "@/lib/inventory/import";
import { DoneBySelect, useDoneBy } from "./pickers";

type State =
  | { step: "choose" }
  | { step: "preview"; fileName: string; rows: ItemPreviewRow[]; skippedExample: boolean }
  | { step: "done"; imported: number; firstCode: string; lastCode: string; opening: { id: string; docNo: string } | null; openingLines: number; bad: ItemPreviewRow[] };

/**
 * "Import items": 1. download the template, 2. upload it filled in, 3. preview every row
 * (problems in plain words), 4. import the good rows; problem rows can be downloaded to fix.
 */
export function ItemImport({ team }: { team: { id: string; name: string }[] }) {
  const [state, setState] = useState<State>({ step: "choose" });
  const [pending, start] = useTransition();
  const [doneBy, setDoneBy] = useDoneBy(team);
  const fileRef = useRef<HTMLInputElement>(null);

  const upload = (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) return void toast.error(IMPORT_TOO_BIG);
    const form = new FormData();
    form.set("file", file);
    start(async () => {
      const r = await previewItemImportAction(form);
      if (fileRef.current) fileRef.current.value = "";
      if (!r.ok) return void toast.error(r.message);
      setState({ step: "preview", ...r.data });
    });
  };

  const downloadProblems = (rows: ItemPreviewRow[]) =>
    start(async () => {
      const r = await itemProblemRowsAction(rows.map((x) => ({ rowNo: x.rowNo, raw: x.raw })));
      if (!r.ok) return void toast.error(r.message);
      const bytes = Uint8Array.from(atob(r.data.base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = r.data.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    });

  const importGood = (s: Extract<State, { step: "preview" }>) =>
    start(async () => {
      const good = s.rows.filter((r) => r.ok);
      const r = await importItemsAction(
        good.map((x) => ({ rowNo: x.rowNo, raw: x.raw })),
        s.fileName,
        doneBy || null,
      );
      if (!r.ok) return void toast.error(r.message);
      toast.success(`${r.data.imported} ${r.data.imported === 1 ? "item" : "items"} imported`);
      setState({ step: "done", imported: r.data.imported, firstCode: r.data.firstCode, lastCode: r.data.lastCode, opening: r.data.openingDoc, openingLines: r.data.openingLines, bad: s.rows.filter((x) => !x.ok) });
    });

  if (state.step === "choose")
    return (
      <ol className="flex max-w-2xl flex-col gap-4">
        <li className="rounded-2xl border bg-card p-5">
          <p className="font-medium">1. Download the template</p>
          <p className="mb-3 text-sm text-muted-foreground">
            It has the right columns, an example row, and a “Lists” sheet with the categories, units and suppliers to use. The green columns are for opening stock (optional).
          </p>
          <Button asChild variant="outline">
            <a href="/api/inventory/import-template" download>
              <Download aria-hidden /> Download Excel template
            </a>
          </Button>
        </li>
        <li className="rounded-2xl border bg-card p-5">
          <p className="font-medium">2. Upload the filled file</p>
          <p className="mb-3 text-sm text-muted-foreground">One item per row, up to {MAX_ITEM_IMPORT_ROWS} rows. Nothing is saved until you check the rows in the next step.</p>
          <input ref={fileRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" id="item-import-file" onChange={(e) => upload(e.target.files?.[0])} />
          <Button asChild disabled={pending}>
            <label htmlFor="item-import-file" className="cursor-pointer">
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Upload aria-hidden />} Choose Excel file
            </label>
          </Button>
        </li>
      </ol>
    );

  if (state.step === "done")
    return (
      <div className="flex max-w-2xl flex-col gap-4">
        <div className="flex items-start gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden />
          <div>
            <p>
              {state.imported} {state.imported === 1 ? "item was" : "items were"} added ({state.firstCode}
              {state.imported > 1 ? ` to ${state.lastCode}` : ""}).
            </p>
            {state.opening ? (
              <p className="mt-1">
                Opening stock for {state.openingLines} {state.openingLines === 1 ? "line" : "lines"} was saved as{" "}
                <Link href={`/inventory/movements/${state.opening.id}`} className="font-medium underline">
                  {state.opening.docNo}
                </Link>
                .
              </p>
            ) : null}
          </div>
        </div>
        {state.bad.length ? (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            <span className="flex-1">
              {state.bad.length} {state.bad.length === 1 ? "row was" : "rows were"} not imported. Download {state.bad.length === 1 ? "it" : "them"}, fix the problems listed, and import the file again.
            </span>
            <Button size="sm" variant="outline" className="bg-white" disabled={pending} onClick={() => downloadProblems(state.bad)}>
              <Download aria-hidden /> Download problem rows
            </Button>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setState({ step: "choose" })}>
            Import another file
          </Button>
          <Button asChild>
            <Link href="/inventory/items">See the items</Link>
          </Button>
        </div>
      </div>
    );

  const s = state;
  const good = s.rows.filter((r) => r.ok);
  const bad = s.rows.filter((r) => !r.ok);
  const withOpening = good.filter((r) => r.opening).length;
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <p className="text-sm">
        <strong>{s.fileName}</strong>: {s.rows.length} {s.rows.length === 1 ? "row" : "rows"}. <span className="font-medium text-emerald-700">{good.length} ready to import</span>
        {bad.length ? (
          <>
            , <span className="font-medium text-red-700">{bad.length} with problems</span>
          </>
        ) : null}
        .{s.skippedExample ? " The example row was skipped." : ""}
      </p>

      {bad.length ? (
        <section aria-labelledby="bad-h" className="rounded-2xl border border-red-200 bg-red-50/60 p-3">
          <h2 id="bad-h" className="mb-2 flex items-center gap-1.5 font-semibold text-red-800">
            <AlertCircle className="size-4" aria-hidden /> Rows with problems (not imported)
          </h2>
          <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto text-sm">
            {bad.map((r) => (
              <li key={r.rowNo} className="rounded-lg bg-white p-2">
                <p className="font-medium">
                  Row {r.rowNo}
                  {r.name ? `: ${r.name}` : ""}
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
        <section aria-labelledby="good-h" className="rounded-2xl border bg-card p-3">
          <h2 id="good-h" className="mb-2 flex items-center gap-1.5 font-semibold text-emerald-800">
            <CheckCircle2 className="size-4" aria-hidden /> Ready to import
          </h2>
          <ul className="max-h-72 divide-y overflow-y-auto text-sm">
            {good.map((r) => (
              <li key={r.rowNo} className="flex flex-wrap items-baseline gap-x-3 py-1.5">
                <span className="w-14 shrink-0 text-muted-foreground tabular-nums">Row {r.rowNo}</span>
                <span className="min-w-0 flex-1 font-medium">{r.name}</span>
                <span className="text-muted-foreground">{r.category}</span>
                <span className="text-muted-foreground">{r.opening ? `Opening stock ${r.opening}` : "No opening stock"}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {withOpening ? (
        <div className="max-w-xs">
          <Field label="Done by (for the opening stock)" optional>
            {(p) => <DoneBySelect id={p.id} team={team} value={doneBy} onChange={setDoneBy} />}
          </Field>
        </div>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={() => setState({ step: "choose" })} disabled={pending}>
          Choose another file
        </Button>
        {bad.length ? (
          <Button variant="outline" onClick={() => downloadProblems(bad)} disabled={pending}>
            <Download aria-hidden /> Download problem rows
          </Button>
        ) : null}
        <Button onClick={() => importGood(s)} disabled={pending || !good.length}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Upload aria-hidden />}
          {good.length ? `Import ${good.length} good ${good.length === 1 ? "row" : "rows"}` : "Nothing to import"}
        </Button>
      </div>
    </div>
  );
}
