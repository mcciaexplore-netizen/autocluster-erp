"use client";

import { AlertTriangle, Check, ClipboardCheck, Loader2, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { useConfirm } from "@/components/common/confirm";
import { Field } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { completeCountAction, discardCountAction, saveCountLineAction, startCountAction } from "@/lib/actions/counts";
import { formatDate } from "@/lib/format";
import type { CountLine } from "@/lib/inventory-data";
import { formatQty, parseQty } from "@/lib/inventory/numbers";
import { cn } from "@/lib/utils";
import { DoneBySelect, useDoneBy } from "./pickers";

type Team = { id: string; name: string }[];

// ---- Start a count --------------------------------------------------------------------------------

export function StartCountButton({ categories, departments, team }: { categories: { id: string; name: string }[]; departments: { code: string; name: string }[]; team: Team }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<"all" | "category" | "department">("all");
  const [categoryId, setCategoryId] = useState("");
  const [deptCode, setDeptCode] = useState("");
  const [touched, setTouched] = useState(false);
  const [doneBy, setDoneBy] = useDoneBy(team);
  const [pending, start] = useTransition();
  const error = scope === "category" && !categoryId ? "Please choose the category." : scope === "department" && !deptCode ? "Please choose the department." : undefined;
  const SCOPES = [
    ["all", "All items"],
    ["category", "One category"],
    ["department", "One department"],
  ] as const;
  return (
    <>
      <Button onClick={() => setOpen(true)} size="lg">
        <ClipboardCheck aria-hidden /> Start a stock count
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form
            noValidate
            className="flex flex-col gap-5"
            onSubmit={(e) => {
              e.preventDefault();
              setTouched(true);
              if (error) return;
              start(async () => {
                const r = await startCountAction({ categoryId: scope === "category" ? categoryId : null, deptCode: scope === "department" ? deptCode : null, doneBy: doneBy || null });
                if (!r.ok) return void toast.error(r.message);
                toast.success(`Count ${r.data.countNo} started: ${r.data.lines} ${r.data.lines === 1 ? "line" : "lines"} to count`);
                setOpen(false);
                router.push(`/inventory/counts/${r.data.id}`);
              });
            }}
          >
            <DialogHeader>
              <DialogTitle>Start a stock count</DialogTitle>
              <DialogDescription>The stock of each item is noted now. Then count what is on the shelves; you can leave and come back.</DialogDescription>
            </DialogHeader>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-medium">What to count</legend>
              <div className="grid grid-cols-3 gap-2">
                {SCOPES.map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={scope === v}
                    onClick={() => setScope(v)}
                    className={cn("min-h-11 rounded-xl border px-2 text-sm font-medium", scope === v ? "border-primary bg-primary text-primary-foreground" : "hover:bg-secondary")}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>
            {scope === "category" ? (
              <Field label="Category" required error={touched ? error : undefined}>
                {(p) => (
                  <Select value={categoryId} onValueChange={setCategoryId}>
                    <SelectTrigger id={p.id} className="w-full" aria-invalid={p["aria-invalid"]}>
                      <SelectValue placeholder="Choose the category" />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </Field>
            ) : null}
            {scope === "department" ? (
              <Field label="Department" required error={touched ? error : undefined}>
                {(p) => (
                  <Select value={deptCode} onValueChange={setDeptCode}>
                    <SelectTrigger id={p.id} className="w-full" aria-invalid={p["aria-invalid"]}>
                      <SelectValue placeholder="Choose the department" />
                    </SelectTrigger>
                    <SelectContent>
                      {departments.map((d) => (
                        <SelectItem key={d.code} value={d.code}>
                          {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </Field>
            ) : null}
            <Field label="Started by" optional>
              {(p) => <DoneBySelect id={p.id} team={team} value={doneBy} onChange={setDoneBy} />}
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? <Loader2 className="animate-spin" aria-hidden /> : <ClipboardCheck aria-hidden />} Start count
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---- Count screen ---------------------------------------------------------------------------------

/** "500.000" -> "500"; null -> "". */
const show = (q: string | null) => (q == null ? "" : String(Number(q)));

type Status = { state: "saving" | "saved" | "error"; message?: string };

export function CountSheet({ countId, lines }: { countId: string; lines: CountLine[] }) {
  // What this person typed (kept even when the page refreshes) and what was saved.
  const [typed, setTyped] = useState<Record<number, string>>({});
  const [saved, setSaved] = useState<Record<number, string | null>>({});
  const [status, setStatus] = useState<Record<number, Status | undefined>>({});
  const [query, setQuery] = useState("");
  const [onlyLeft, setOnlyLeft] = useState(false);
  const inputs = useRef(new Map<number, HTMLInputElement>());

  const savedValue = (l: CountLine) => (l.id in saved ? saved[l.id] : l.countedQty);
  const done = lines.filter((l) => savedValue(l) != null).length;
  const moved = lines.filter((l) => Number(l.movedQty) !== 0);
  const q = query.trim().toLowerCase();
  const visible = lines.filter(
    (l) => (!onlyLeft || savedValue(l) == null || typed[l.id] !== undefined) && (!q || `${l.name} ${l.code} ${l.batchNo ?? ""} ${l.place ?? ""}`.toLowerCase().includes(q)),
  );

  async function save(l: CountLine) {
    const raw = (typed[l.id] ?? show(savedValue(l))).trim();
    const before = savedValue(l);
    if (raw === show(before)) return;
    if (raw !== "" && (parseQty(raw) == null || Number(raw) < 0)) {
      setStatus((s) => ({ ...s, [l.id]: { state: "error", message: "Enter a number, e.g. 12 or 2.5" } }));
      return;
    }
    setStatus((s) => ({ ...s, [l.id]: { state: "saving" } }));
    const r = await saveCountLineAction(l.id, raw === "" ? null : raw);
    if (!r.ok) {
      setStatus((s) => ({ ...s, [l.id]: { state: "error", message: r.message } }));
      return;
    }
    setSaved((s) => ({ ...s, [l.id]: r.data.counted }));
    setStatus((s) => ({ ...s, [l.id]: { state: "saved" } }));
  }

  function next(l: CountLine) {
    const i = visible.findIndex((v) => v.id === l.id);
    const n = visible[i + 1];
    if (n) inputs.current.get(n.id)?.focus();
    else inputs.current.get(l.id)?.blur();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="sticky top-0 z-10 -mx-1 flex flex-col gap-2 rounded-2xl border bg-card p-4 shadow-sm">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-lg font-semibold tabular-nums" aria-live="polite">
            {done} of {lines.length} counted
          </p>
          <span className="text-sm text-muted-foreground">Saves as you go</span>
        </div>
        <Progress value={lines.length ? (done / lines.length) * 100 : 0} aria-label={`${done} of ${lines.length} counted`} />
      </div>

      {moved.length ? (
        <p className="flex gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Stock moved for {moved.length} {moved.length === 1 ? "item" : "items"} since the count started. Count what is on the shelf now: it is compared with the stock at the start plus or minus what moved since.
          </span>
        </p>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find an item, code, batch or place" className="h-11 pl-9" aria-label="Find an item" />
        </div>
        <button
          type="button"
          aria-pressed={onlyLeft}
          onClick={() => setOnlyLeft((v) => !v)}
          className={cn("min-h-11 rounded-xl border px-4 text-sm font-medium", onlyLeft ? "border-primary bg-primary text-primary-foreground" : "hover:bg-secondary")}
        >
          Not counted yet ({lines.length - done})
        </button>
      </div>

      <ul className="divide-y rounded-2xl border bg-card">
        {visible.map((l) => {
          const st = status[l.id];
          const value = typed[l.id] ?? show(savedValue(l));
          const mv = Number(l.movedQty);
          return (
            <li key={l.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{l.name}</p>
                <p className="text-sm text-muted-foreground">{[l.code, l.place, l.category].filter(Boolean).join(" · ")}</p>
                {l.batchNo ? (
                  <p className="text-sm">
                    Batch <span className="font-medium">{l.batchNo}</span>
                    {l.expiryDate ? ` · expires ${formatDate(l.expiryDate)}` : ""}
                  </p>
                ) : null}
                {mv !== 0 ? (
                  <p className="mt-1 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                    {mv > 0 ? "Added" : "Taken out"} since the count started: {formatQty(Math.abs(mv), l.unit)}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-col items-stretch gap-1 sm:w-48">
                <label className="flex items-center gap-2">
                  <span className="sr-only">Counted quantity of {l.name}{l.batchNo ? `, batch ${l.batchNo}` : ""}</span>
                  <Input
                    ref={(el) => {
                      if (el) inputs.current.set(l.id, el);
                      else inputs.current.delete(l.id);
                    }}
                    inputMode="decimal"
                    enterKeyHint="next"
                    autoComplete="off"
                    value={value}
                    placeholder="Count"
                    onChange={(e) => {
                      setTyped((t) => ({ ...t, [l.id]: e.target.value }));
                      if (st?.state !== "saving") setStatus((s) => ({ ...s, [l.id]: undefined }));
                    }}
                    onBlur={() => void save(l)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        next(l);
                      }
                    }}
                    aria-invalid={st?.state === "error" || undefined}
                    className="h-14 flex-1 text-right text-xl font-semibold tabular-nums md:text-xl"
                  />
                  <span className="w-12 text-sm text-muted-foreground">{l.unit}</span>
                </label>
                <p className={cn("min-h-5 text-right text-xs", st?.state === "error" ? "text-destructive" : "text-muted-foreground")} role={st?.state === "error" ? "alert" : undefined}>
                  {st?.state === "saving" ? (
                    "Saving…"
                  ) : st?.state === "error" ? (
                    st.message
                  ) : st?.state === "saved" ? (
                    <span className="inline-flex items-center gap-1 text-emerald-700">
                      <Check className="size-3.5" aria-hidden /> Saved
                    </span>
                  ) : null}
                </p>
              </div>
            </li>
          );
        })}
        {!visible.length ? <li className="px-4 py-8 text-center text-muted-foreground">{onlyLeft ? "Everything here has been counted." : "No items match."}</li> : null}
      </ul>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <DiscardCountButton countId={countId} />
        <Button asChild size="lg">
          <Link href={`/inventory/counts/${countId}?step=review`}>Review differences</Link>
        </Button>
      </div>
    </div>
  );
}

// ---- Complete / discard ---------------------------------------------------------------------------

export function CompleteCountButton({ countId, countNo, changes, notCounted, team }: { countId: string; countNo: string; changes: number; notCounted: number; team: Team }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [doneBy, setDoneBy] = useDoneBy(team);
  const [pending, start] = useTransition();
  return (
    <>
      <Button size="lg" onClick={() => setOpen(true)}>
        <Check aria-hidden /> Complete count
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Complete count {countNo}?</DialogTitle>
            <DialogDescription>
              {changes
                ? `One Stock adjusted record is made for the ${changes} ${changes === 1 ? "difference" : "differences"}, so stock matches what was counted.`
                : "Everything counted matches the stock, so no stock record is needed."}{" "}
              {notCounted ? `${notCounted} ${notCounted === 1 ? "line wasn't" : "lines weren't"} counted and will be left as ${notCounted === 1 ? "it is" : "they are"}. ` : ""}
              The count is then locked.
            </DialogDescription>
          </DialogHeader>
          <Field label="Done by" optional>
            {(p) => <DoneBySelect id={p.id} team={team} value={doneBy} onChange={setDoneBy} />}
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Not yet
            </Button>
            <Button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await completeCountAction(countId, doneBy || null);
                  if (!r.ok) return void toast.error(r.message);
                  toast.success(r.data.adjustment ? `Count ${countNo} completed. Stock adjusted: ${r.data.adjustment.docNo}` : `Count ${countNo} completed. No differences.`);
                  setOpen(false);
                  router.replace(`/inventory/counts/${countId}`);
                  router.refresh();
                })
              }
            >
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />} Complete count
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function DiscardCountButton({ countId }: { countId: string }) {
  const router = useRouter();
  const [dialog, confirm] = useConfirm();
  const [pending, start] = useTransition();
  return (
    <>
      <Button
        variant="ghost"
        className="text-destructive hover:text-destructive"
        disabled={pending}
        onClick={async () => {
          const ok = await confirm({
            title: "Discard this count?",
            description: "Everything counted so far is thrown away. Stock doesn't change.",
            confirmLabel: "Discard count",
            cancelLabel: "Keep counting",
            destructive: true,
          });
          if (!ok) return;
          start(async () => {
            const r = await discardCountAction(countId);
            if (!r.ok) return void toast.error(r.message);
            toast.success(`Count ${r.data.countNo} discarded`);
            router.push("/inventory/counts");
          });
        }}
      >
        <Trash2 aria-hidden /> Discard count
      </Button>
      {dialog}
    </>
  );
}
