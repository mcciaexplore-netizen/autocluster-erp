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
import type { StockFormData, StockFormItem, TicketForUse } from "@/lib/inventory-data";
import { suggestMaterials, type Material } from "@/lib/inventory/materials";
import { D, formatQty, parseQty, parseRate, valuePaise } from "@/lib/inventory/numbers";
import { formatINR } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import { DoneBySelect, ItemPicker, TicketPicker, useDoneBy } from "./pickers";

const AUTO = "auto";
let seq = 0;

/** Batches a line can use (not expired), the one that expires first first. */
function usable(item: StockFormItem) {
  return item.batches.filter((b) => !b.expired);
}

// ---- Use stock ----------------------------------------------------------------------------------------

type UseLine = { key: number; itemId: string; qty: string; batchId: string; explain?: string };
const blankUse = (itemId = ""): UseLine => ({ key: ++seq, itemId, qty: "", batchId: AUTO });

/** The suggested lines for a ticket: its service's materials x the ticket's billable quantity. */
function suggestedLines(t: TicketForUse | undefined, materials: Record<number, Material[]>): UseLine[] {
  if (!t?.serviceId) return [];
  return suggestMaterials(t.billableQty, t.unitLabel, materials[t.serviceId] ?? []).map((s) => ({ key: ++seq, itemId: s.itemId, qty: s.qty, batchId: AUTO, explain: s.explain }));
}

export function UseForm({
  data,
  startItemId,
  tickets,
  materials,
  startTicketId,
}: {
  data: StockFormData;
  startItemId?: string;
  tickets: TicketForUse[];
  materials: Record<number, Material[]>;
  startTicketId?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const startTicket = tickets.find((t) => t.id === startTicketId);
  const [mode, setMode] = useState<"job" | "internal">(startItemId && !startTicket ? "internal" : "job");
  const [ticketId, setTicketId] = useState(startTicket?.id ?? "");
  const [purposeId, setPurposeId] = useState("");
  const [note, setNote] = useState("");
  const [doneBy, setDoneBy] = useDoneBy(data.team);
  const [lines, setLines] = useState<UseLine[]>(() => {
    const s = suggestedLines(startTicket, materials);
    return s.length ? s : [blankUse(startItemId ?? "")];
  });
  const ticket = tickets.find((t) => t.id === ticketId);
  const chooseTicket = (id: string) => {
    setTicketId(id);
    const s = suggestedLines(
      tickets.find((t) => t.id === id),
      materials,
    );
    // Suggestions replace the lines that are still empty; anything typed stays.
    setLines((ls) => {
      const typed = ls.filter((l) => l.itemId && !l.explain);
      const next = [...typed, ...s.filter((x) => !typed.some((t) => t.itemId === x.itemId))];
      return next.length ? next : [blankUse()];
    });
  };
  const itemOf = (id: string) => data.items.find((i) => i.id === id);
  const update = (key: number, patch: Partial<UseLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const isOther = data.purposes.find((p) => p.id === purposeId)?.name.toLowerCase() === "other";
  const value = lines.reduce((a, l) => {
    const i = itemOf(l.itemId);
    const q = parseQty(l.qty);
    return a + (i && q ? valuePaise(q, i.avgCost) : 0);
  }, 0);

  const save = () => {
    if (mode === "job" && !ticketId) return void toast.error("Please choose the job (ticket).");
    if (mode === "internal" && !purposeId) return void toast.error("Please choose what the stock was used for.");
    if (mode === "internal" && isOther && note.trim().length < 3) return void toast.error("Please write a short note about what the stock was used for.");
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
      const r = await issueStockAction({ ticketId: mode === "job" ? ticketId : null, purposeId: mode === "internal" ? purposeId : null, note: note || null, doneBy: doneBy || null, lines: used.map((l) => ({ itemId: l.itemId, qty: l.qty, batchId: l.batchId === AUTO ? null : l.batchId })) });
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
            <div className="flex flex-col gap-2 md:col-span-2">
              <span className="text-base font-medium">
                Job (ticket) <span className="text-destructive">*</span>
              </span>
              <TicketPicker tickets={tickets} value={ticketId} onChange={chooseTicket} />
              {ticket ? (
                <p className="text-sm text-muted-foreground">
                  {ticket.description} · {ticket.quantityText}
                  {ticket.recorded ? " · Materials already recorded for this job; this adds more." : ""}
                  {ticket.serviceId && !(materials[ticket.serviceId]?.length) ? " · This service has no materials list yet, so add the items yourself." : ""}
                </p>
              ) : null}
            </div>
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
                    <Field label="Quantity used" required helper={`${l.explain ? `Suggested: ${l.explain}. ` : ""}In stock: ${formatQty(item.qty, item.unit)}`} error={tooMuch ? `Only ${formatQty(item.qty, item.unit)} of ${item.name} in stock. You entered ${formatQty(q!, item.unit)}.` : undefined}>
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

type Mode = "REMOVE" | "ADD" | "OPENING";
type AdjLine = { key: number; itemId: string; mode: Mode; qty: string; reasonId: string; rate: string; batchId: string; newBatchNo: string; newExpiry: string };
const NEW = "new";
const blankAdj = (itemId = ""): AdjLine => ({ key: ++seq, itemId, mode: "REMOVE", qty: "", reasonId: "", rate: "", batchId: "", newBatchNo: "", newExpiry: "" });
/** A rate is asked for opening stock, and for added stock while the item has no average cost yet. */
const needsRate = (l: AdjLine, item: StockFormItem) => l.mode === "OPENING" || (l.mode === "ADD" && Number(item.avgCost) <= 0);

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
      if (l.mode !== "OPENING" && !l.reasonId) return void toast.error(`Line ${n + 1} (${i.name}): please choose the reason.`);
      if (needsRate(l, i) && !(Number(parseRate(l.rate)) > 0)) return void toast.error(`Line ${n + 1} (${i.name}): please enter the rate per ${i.unit} before GST, e.g. 4.50.`);
      if (i.trackBatches && !l.batchId) return void toast.error(`Line ${n + 1} (${i.name}): please choose the batch.`);
      if (i.trackBatches && l.batchId === NEW && (!l.newBatchNo.trim() || !l.newExpiry)) return void toast.error(`Line ${n + 1} (${i.name}): please enter the new batch number and expiry date.`);
    }
    start(async () => {
      const r = await adjustStockAction({
        note,
        doneBy: doneBy || null,
        lines: used.map((l) => ({
          itemId: l.itemId,
          direction: l.mode === "REMOVE" ? ("REMOVE" as const) : ("ADD" as const),
          opening: l.mode === "OPENING",
          unitCost: needsRate(l, itemOf(l.itemId)!) ? l.rate : null,
          qty: l.qty,
          reasonId: l.mode === "OPENING" ? null : l.reasonId,
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
      <FormSection title="Adjustment" description="For corrections, damage, spills, expired stock, and opening stock when you start." icon={<SlidersHorizontal className="size-5" />}>
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
                    <Field label="What kind of change?" required className="md:col-span-2">
                      {() => (
                        <div role="radiogroup" aria-label="What kind of change?" className="inline-flex flex-wrap rounded-xl border bg-secondary p-1">
                          {(
                            [
                              ["REMOVE", "Remove"],
                              ["ADD", "Add"],
                              ["OPENING", "Opening stock"],
                            ] as const
                          ).map(([m, label]) => (
                            <button
                              key={m}
                              type="button"
                              role="radio"
                              aria-checked={l.mode === m}
                              onClick={() => update(l.key, { mode: m, batchId: "" })}
                              className={cn("h-9 rounded-lg px-3 text-sm font-medium whitespace-nowrap", l.mode === m ? "bg-card text-primary shadow-sm" : "text-muted-foreground")}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      )}
                    </Field>
                    <Field label="Quantity" required helper={`In stock: ${formatQty(item.qty, item.unit)}`}>
                      {(p) => (
                        <div className="flex items-center gap-2">
                          <Input {...p} inputMode="decimal" value={l.qty} onChange={(e) => update(l.key, { qty: e.target.value })} className="min-w-0 flex-1" />
                          <span className="text-muted-foreground">{item.unit}</span>
                        </div>
                      )}
                    </Field>
                    {needsRate(l, item) ? (
                      <Field label={`Rate per ${item.unit}, before GST`} required helper={l.mode === "OPENING" ? "What this stock cost, e.g. 4.50" : "This item has no average cost yet, so enter what this stock cost"}>
                        {(p) => (
                          <div className="flex min-w-0 items-center rounded-xl border bg-card focus-within:ring-2 focus-within:ring-ring">
                            <span className="pl-3 text-muted-foreground">₹</span>
                            <Input {...p} inputMode="decimal" value={l.rate} onChange={(e) => update(l.key, { rate: e.target.value })} className="border-0 shadow-none focus-visible:ring-0" />
                          </div>
                        )}
                      </Field>
                    ) : null}
                    {l.mode !== "OPENING" ? (
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
                    ) : null}
                    {item.trackBatches ? (
                      <Field label="Batch" required helper={l.mode === "REMOVE" ? "Expired batches are listed too, so they can be written off." : undefined}>
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
                              {l.mode !== "REMOVE" ? <SelectItem value={NEW}>A new batch…</SelectItem> : null}
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
        Added stock is valued at the item&apos;s average cost. Opening stock uses the rate you enter.
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
