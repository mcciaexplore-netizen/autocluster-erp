"use client";

import { AlertTriangle, Briefcase, FlaskConical, Loader2, PackageMinus, Plus, Save, SlidersHorizontal, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Field, FormSection } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { adjustStockAction, issueStockAction } from "@/lib/actions/stock";
import { formatDate } from "@/lib/format";
import type { StockFormData, StockFormItem } from "@/lib/inventory-data";
import { D, formatQty, parseQty, valuePaise } from "@/lib/inventory/numbers";
import { formatINR } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import { DoneBySelect, ItemPicker, useDoneBy } from "./pickers";
import { Toggle } from "./receive-form";

const AUTO = "auto";
let seq = 0;

/** Batches a line can use (not expired), the one that expires first first. */
function usable(item: StockFormItem) {
  return item.batches.filter((b) => !b.expired);
}

// ---- Use stock ----------------------------------------------------------------------------------------

type UseLine = { key: number; itemId: string; qty: string; batchId: string };
const blankUse = (itemId = ""): UseLine => ({ key: ++seq, itemId, qty: "", batchId: AUTO });

export function UseForm({ data, startItemId, jobPicker }: { data: StockFormData; startItemId?: string; jobPicker?: React.ReactNode }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"job" | "internal">(jobPicker ? "job" : "internal");
  const [purposeId, setPurposeId] = useState("");
  const [note, setNote] = useState("");
  const [doneBy, setDoneBy] = useDoneBy(data.team);
  const [lines, setLines] = useState<UseLine[]>([blankUse(startItemId ?? "")]);
  const itemOf = (id: string) => data.items.find((i) => i.id === id);
  const update = (key: number, patch: Partial<UseLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const isOther = data.purposes.find((p) => p.id === purposeId)?.name.toLowerCase() === "other";
  const value = lines.reduce((a, l) => {
    const i = itemOf(l.itemId);
    const q = parseQty(l.qty);
    return a + (i && q ? valuePaise(q, i.avgCost) : 0);
  }, 0);

  const save = () => {
    if (mode === "job") return void toast.error("Choose the job first.");
    if (!purposeId) return void toast.error("Please choose what the stock was used for.");
    if (isOther && note.trim().length < 3) return void toast.error("Please write a short note about what the stock was used for.");
    const used = lines.filter((l) => l.itemId);
    if (!used.length) return void toast.error("Please add at least one item.");
    // The same "not enough stock" check the server does, shown before saving.
    const totals = new Map<string, number>();
    for (const l of used) totals.set(l.itemId, (totals.get(l.itemId) ?? 0) + Number(parseQty(l.qty) ?? NaN));
    for (const [id, q] of totals) {
      const i = itemOf(id)!;
      if (!(q > 0)) return void toast.error(`${i.name}: please enter the quantity used.`);
      if (D(q).gt(D(i.qty))) return void toast.error(`Only ${formatQty(i.qty, i.unit)} of ${i.name} in stock. You entered ${formatQty(q, i.unit)}.`);
    }
    start(async () => {
      const r = await issueStockAction({ purposeId, note: note || null, doneBy: doneBy || null, lines: used.map((l) => ({ itemId: l.itemId, qty: l.qty, batchId: l.batchId === AUTO ? null : l.batchId })) });
      if (!r.ok) return void toast.error(r.message);
      toast.success(`Stock used: ${r.data.docNo}`);
      router.push(`/inventory/movements/${r.data.id}`);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <FormSection title="What is this for?" icon={<PackageMinus className="size-5" />}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <BigChoice on={mode === "job"} onClick={() => setMode("job")} icon={Briefcase} title="For a job" text="Pick the ticket. Materials are suggested from the service." />
          <BigChoice on={mode === "internal"} onClick={() => setMode("internal")} icon={FlaskConical} title="Internal use" text="Machine maintenance, trial runs, training, R&D and so on." />
        </div>
        <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2">
          {mode === "job" ? (
            <div className="md:col-span-2">{jobPicker ?? <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Choosing a job is added in the next step. For now, use “Internal use”.</p>}</div>
          ) : (
            <Field label="Purpose" required>
              {(p) => (
                <Select value={purposeId} onValueChange={setPurposeId}>
                  <SelectTrigger {...p} className="w-full">
                    <SelectValue placeholder="Choose purpose" />
                  </SelectTrigger>
                  <SelectContent>
                    {data.purposes.map((x) => (
                      <SelectItem key={x.id} value={x.id}>
                        {x.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
          )}
          <Field label="Done by" optional helper="Remembered on this device">
            {(p) => <DoneBySelect id={p.id} team={data.team} value={doneBy} onChange={setDoneBy} />}
          </Field>
          <Field label="Note" required={isOther} optional={!isOther} className="md:col-span-2" helper={isOther ? "Required for “Other”, e.g. Visitor demo" : undefined}>
            {(p) => <Textarea {...p} rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />}
          </Field>
        </div>
      </FormSection>

      <section className="flex flex-col gap-3" aria-label="Items used">
        <h2 className="text-lg font-semibold">Items used</h2>
        {lines.map((l, n) => {
          const item = itemOf(l.itemId);
          const q = parseQty(l.qty);
          const tooMuch = item && q && D(q).gt(D(item.qty));
          const expired = item ? item.batches.filter((b) => b.expired) : [];
          return (
            <div key={l.key} className="rounded-2xl border bg-card p-4">
              <LineHead n={n} canRemove={lines.length > 1} onRemove={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} />
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <ItemPicker items={data.items} value={l.itemId} onChange={(id) => update(l.key, { itemId: id, batchId: AUTO })} />
                </div>
                {item ? (
                  <>
                    <Field label="Quantity used" required helper={`In stock: ${formatQty(item.qty, item.unit)}`} error={tooMuch ? `Only ${formatQty(item.qty, item.unit)} of ${item.name} in stock. You entered ${formatQty(q!, item.unit)}.` : undefined}>
                      {(p) => (
                        <div className="flex items-center gap-2">
                          <Input {...p} inputMode="decimal" value={l.qty} onChange={(e) => update(l.key, { qty: e.target.value })} className="min-w-0 flex-1" />
                          <span className="text-muted-foreground">{item.unit}</span>
                        </div>
                      )}
                    </Field>
                    {item.trackBatches ? (
                      <Field label="Batch" helper="Uses the batch that expires first, unless you choose one.">
                        {(p) => (
                          <Select value={l.batchId} onValueChange={(v) => update(l.key, { batchId: v })}>
                            <SelectTrigger {...p} className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={AUTO}>The batch that expires first</SelectItem>
                              {usable(item).map((b) => (
                                <SelectItem key={b.id} value={b.id}>
                                  {b.batchNo} · {formatQty(b.qty, item.unit)}
                                  {b.expiryDate ? ` · expires ${formatDate(b.expiryDate)}` : ""}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </Field>
                    ) : null}
                    {expired.length ? (
                      <p className="flex items-start gap-2 text-sm text-amber-800 md:col-span-2">
                        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                        {expired.length} expired {expired.length === 1 ? "batch" : "batches"} ({formatQty(expired.reduce((a, b) => a + Number(b.qty), 0), item.unit)}), adjust {expired.length === 1 ? "it" : "them"} out instead.
                      </p>
                    ) : null}
                  </>
                ) : null}
              </div>
            </div>
          );
        })}
        <Button type="button" variant="outline" className="self-start" onClick={() => setLines((ls) => [...ls, blankUse()])}>
          <Plus aria-hidden /> Add another item
        </Button>
      </section>

      <SaveBar label="Save stock used" pending={pending} onSave={save}>
        Value at average cost: <strong className="tabular-nums">{formatINR(value)}</strong>
      </SaveBar>
    </div>
  );
}

// ---- Adjust stock ---------------------------------------------------------------------------------------

type AdjLine = { key: number; itemId: string; direction: "ADD" | "REMOVE"; qty: string; reasonId: string; batchId: string; newBatchNo: string; newExpiry: string };
const NEW = "new";
const blankAdj = (itemId = ""): AdjLine => ({ key: ++seq, itemId, direction: "REMOVE", qty: "", reasonId: "", batchId: "", newBatchNo: "", newExpiry: "" });

export function AdjustForm({ data, startItemId }: { data: StockFormData; startItemId?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState("");
  const [doneBy, setDoneBy] = useDoneBy(data.team);
  const [lines, setLines] = useState<AdjLine[]>([blankAdj(startItemId ?? "")]);
  const itemOf = (id: string) => data.items.find((i) => i.id === id);
  const update = (key: number, patch: Partial<AdjLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const save = () => {
    if (note.trim().length < 3) return void toast.error("Please write a short note about why the stock is being adjusted.");
    const used = lines.filter((l) => l.itemId);
    if (!used.length) return void toast.error("Please add at least one item.");
    for (const [n, l] of used.entries()) {
      const i = itemOf(l.itemId)!;
      if (!parseQty(l.qty) || Number(parseQty(l.qty)) <= 0) return void toast.error(`Line ${n + 1} (${i.name}): please enter the quantity.`);
      if (!l.reasonId) return void toast.error(`Line ${n + 1} (${i.name}): please choose the reason.`);
      if (i.trackBatches && !l.batchId) return void toast.error(`Line ${n + 1} (${i.name}): please choose the batch.`);
      if (i.trackBatches && l.batchId === NEW && (!l.newBatchNo.trim() || !l.newExpiry)) return void toast.error(`Line ${n + 1} (${i.name}): please enter the new batch number and expiry date.`);
    }
    start(async () => {
      const r = await adjustStockAction({
        note,
        doneBy: doneBy || null,
        lines: used.map((l) => ({
          itemId: l.itemId,
          direction: l.direction,
          qty: l.qty,
          reasonId: l.reasonId,
          batchId: l.batchId && l.batchId !== NEW ? l.batchId : null,
          newBatchNo: l.batchId === NEW ? l.newBatchNo : null,
          newExpiryDate: l.batchId === NEW ? l.newExpiry : null,
        })),
      });
      if (!r.ok) return void toast.error(r.message);
      toast.success(`Stock adjusted: ${r.data.docNo}`);
      router.push(`/inventory/movements/${r.data.id}`);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <FormSection title="Adjustment" description="For corrections, damage, spills and expired stock." icon={<SlidersHorizontal className="size-5" />}>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <Field label="Note" required className="md:col-span-2" helper="e.g. Two bottles cracked in transit">
            {(p) => <Textarea {...p} rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />}
          </Field>
          <Field label="Done by" optional helper="Remembered on this device">
            {(p) => <DoneBySelect id={p.id} team={data.team} value={doneBy} onChange={setDoneBy} />}
          </Field>
        </div>
      </FormSection>

      <section className="flex flex-col gap-3" aria-label="Items adjusted">
        <h2 className="text-lg font-semibold">Items</h2>
        {lines.map((l, n) => {
          const item = itemOf(l.itemId);
          return (
            <div key={l.key} className="rounded-2xl border bg-card p-4">
              <LineHead n={n} canRemove={lines.length > 1} onRemove={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} />
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <ItemPicker items={data.items} value={l.itemId} onChange={(id) => update(l.key, { itemId: id, batchId: "" })} />
                </div>
                {item ? (
                  <>
                    <Field label="Add or remove" required>
                      {() => <Toggle a="Remove" b="Add" bOn={l.direction === "ADD"} onChange={(v) => update(l.key, { direction: v ? "ADD" : "REMOVE", batchId: "" })} label="Add or remove" />}
                    </Field>
                    <Field label="Quantity" required helper={`In stock: ${formatQty(item.qty, item.unit)}`}>
                      {(p) => (
                        <div className="flex items-center gap-2">
                          <Input {...p} inputMode="decimal" value={l.qty} onChange={(e) => update(l.key, { qty: e.target.value })} className="min-w-0 flex-1" />
                          <span className="text-muted-foreground">{item.unit}</span>
                        </div>
                      )}
                    </Field>
                    <Field label="Reason" required>
                      {(p) => (
                        <Select value={l.reasonId} onValueChange={(v) => update(l.key, { reasonId: v })}>
                          <SelectTrigger {...p} className="w-full">
                            <SelectValue placeholder="Choose reason" />
                          </SelectTrigger>
                          <SelectContent>
                            {data.reasons.map((r) => (
                              <SelectItem key={r.id} value={r.id}>
                                {r.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </Field>
                    {item.trackBatches ? (
                      <Field label="Batch" required helper={l.direction === "REMOVE" ? "Expired batches are listed too, so they can be written off." : undefined}>
                        {(p) => (
                          <Select value={l.batchId} onValueChange={(v) => update(l.key, { batchId: v })}>
                            <SelectTrigger {...p} className="w-full">
                              <SelectValue placeholder="Choose batch" />
                            </SelectTrigger>
                            <SelectContent>
                              {item.batches.map((b) => (
                                <SelectItem key={b.id} value={b.id}>
                                  {b.batchNo} · {formatQty(b.qty, item.unit)}
                                  {b.expiryDate ? ` · ${b.expired ? "expired" : "expires"} ${formatDate(b.expiryDate)}` : ""}
                                </SelectItem>
                              ))}
                              {l.direction === "ADD" ? <SelectItem value={NEW}>A new batch…</SelectItem> : null}
                            </SelectContent>
                          </Select>
                        )}
                      </Field>
                    ) : null}
                    {item.trackBatches && l.batchId === NEW ? (
                      <>
                        <Field label="New batch no." required>
                          {(p) => <Input {...p} value={l.newBatchNo} onChange={(e) => update(l.key, { newBatchNo: e.target.value })} maxLength={40} />}
                        </Field>
                        <Field label="Expiry date" required>
                          {(p) => <Input {...p} type="date" value={l.newExpiry} onChange={(e) => update(l.key, { newExpiry: e.target.value })} />}
                        </Field>
                      </>
                    ) : null}
                  </>
                ) : null}
              </div>
            </div>
          );
        })}
        <Button type="button" variant="outline" className="self-start" onClick={() => setLines((ls) => [...ls, blankAdj()])}>
          <Plus aria-hidden /> Add another item
        </Button>
      </section>

      <SaveBar label="Save adjustment" pending={pending} onSave={save}>
        Added stock is valued at the item&apos;s average cost.
      </SaveBar>
    </div>
  );
}

// ---- shared ---------------------------------------------------------------------------------------------

function LineHead({ n, canRemove, onRemove }: { n: number; canRemove: boolean; onRemove: () => void }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <span className="text-sm font-medium text-muted-foreground">Line {n + 1}</span>
      {canRemove ? (
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove line ${n + 1}`} onClick={onRemove}>
          <Trash2 aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}

function SaveBar({ label, pending, onSave, children }: { label: string; pending: boolean; onSave: () => void; children: React.ReactNode }) {
  return (
    <div className="sticky bottom-20 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card/95 p-4 shadow-lg backdrop-blur md:bottom-4">
      <p className="text-sm">{children}</p>
      <Button onClick={onSave} disabled={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />} {label}
      </Button>
    </div>
  );
}

export function BigChoice({ on, onClick, icon: Icon, title, text }: { on: boolean; onClick: () => void; icon: React.ComponentType<{ className?: string }>; title: string; text: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn("flex min-h-24 items-start gap-3 rounded-2xl border-2 p-4 text-left transition", on ? "border-primary bg-secondary" : "bg-card hover:border-primary/40")}
    >
      <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", on ? "bg-primary text-primary-foreground" : "bg-secondary text-primary")}>
        <Icon className="size-5" />
      </span>
      <span>
        <span className="block font-semibold">{title}</span>
        <span className="block text-sm text-muted-foreground">{text}</span>
      </span>
    </button>
  );
}
