"use client";

import { Loader2, PackagePlus, Plus, Save, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Field, FormSection } from "@/components/forms/field";
import { FileField } from "@/components/orders/file-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { receiveStockAction } from "@/lib/actions/stock";
import type { BlobEnv, UploadedFile } from "@/lib/files";
import type { StockFormData } from "@/lib/inventory-data";
import { D, formatQty, packRateToUnitRate, packsToUnits, packText, parseQty, parseRate, valuePaise } from "@/lib/inventory/numbers";
import { formatINR } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import { EMPTY_SUPPLIER_FORM } from "@/lib/validation/inventory";
import { DoneBySelect, ItemPicker, SupplierPicker, useDoneBy } from "./pickers";
import { SupplierForm } from "./supplier-form";

type Line = { key: number; itemId: string; qty: string; inPacks: boolean; rate: string; ratePerPack: boolean; batchNo: string; expiryDate: string };
let seq = 0;
const blankLine = (itemId = ""): Line => ({ key: ++seq, itemId, qty: "", inPacks: false, rate: "", ratePerPack: false, batchNo: "", expiryDate: "" });

/** One line's numbers: quantity in units, rate per unit, line total (paise). */
function lineMath(l: Line, item: StockFormData["items"][number] | undefined) {
  const q = parseQty(l.qty);
  const r = parseRate(l.rate);
  if (!item || !q || r == null) return null;
  const pack = item.packSize && D(item.packSize).gt(0) ? item.packSize : null;
  const units = l.inPacks && pack ? packsToUnits(q, pack) : q;
  const unitRate = l.ratePerPack && pack ? packRateToUnitRate(r, pack) : r;
  return { units, unitRate, total: valuePaise(units, unitRate) };
}

export function ReceiveForm({ data, uploadEnv, startItemId }: { data: StockFormData; uploadEnv: BlobEnv; startItemId?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [suppliers, setSuppliers] = useState(data.suppliers);
  const startItem = data.items.find((i) => i.id === startItemId);
  const [supplierId, setSupplierId] = useState(startItem?.preferredSupplierId ?? "");
  const [billNo, setBillNo] = useState("");
  const [billDate, setBillDate] = useState(data.today);
  const [bill, setBill] = useState<UploadedFile | null>(null);
  const [uploading, setUploading] = useState(false);
  const [note, setNote] = useState("");
  const [doneBy, setDoneBy] = useDoneBy(data.team);
  const [lines, setLines] = useState<Line[]>([blankLine(startItemId ?? "")]);
  const [adding, setAdding] = useState(false);
  const [tried, setTried] = useState(false);

  const itemOf = (id: string) => data.items.find((i) => i.id === id);
  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const pickItem = (key: number, itemId: string) => {
    const item = itemOf(itemId);
    const last = item && supplierId ? item.supplierRates[supplierId] : undefined;
    update(key, { itemId, inPacks: !!item?.packSize, ratePerPack: !!item?.packSize, rate: last && item?.packSize ? String(D(last).mul(D(item.packSize)).toDecimalPlaces(2).toNumber()) : last ? String(Number(last)) : "" });
  };
  const total = lines.reduce((a, l) => a + (lineMath(l, itemOf(l.itemId))?.total ?? 0), 0);

  const save = () => {
    setTried(true);
    if (!supplierId) return void toast.error("Please choose the supplier.");
    if (uploading) return void toast.error("Please wait for the bill to finish uploading.");
    const used = lines.filter((l) => l.itemId);
    if (!used.length) return void toast.error("Please add at least one item.");
    for (const [n, l] of used.entries()) {
      const item = itemOf(l.itemId)!;
      if (!parseQty(l.qty) || D(parseQty(l.qty)!).lte(0)) return void toast.error(`Line ${n + 1} (${item.name}): please enter the quantity received.`);
      if (parseRate(l.rate) == null) return void toast.error(`Line ${n + 1} (${item.name}): please enter the rate before GST, e.g. 4.50.`);
      if (item.trackBatches && (!l.batchNo.trim() || !l.expiryDate)) return void toast.error(`Line ${n + 1} (${item.name}): please enter the batch number and expiry date.`);
    }
    start(async () => {
      const r = await receiveStockAction({
        supplierId,
        supplierBillNo: billNo || null,
        supplierBillDate: billDate || null,
        fileId: bill?.id ?? null,
        doneBy: doneBy || null,
        note: note || null,
        lines: used.map((l) => ({ itemId: l.itemId, qty: l.qty, inPacks: l.inPacks, rate: l.rate, ratePerPack: l.ratePerPack, batchNo: l.batchNo || null, expiryDate: l.expiryDate || null })),
      });
      if (!r.ok) return void toast.error(r.message);
      toast.success(`Stock received: ${r.data.docNo}`);
      router.push(`/inventory/movements/${r.data.id}`);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <FormSection title="Delivery" icon={<PackagePlus className="size-5" />}>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <Field label="Supplier" required error={tried && !supplierId ? "Please choose the supplier." : undefined}>
            {() => <SupplierPicker suppliers={suppliers} value={supplierId} onChange={setSupplierId} onAddNew={() => setAdding(true)} invalid={tried && !supplierId} />}
          </Field>
          <Field label="Done by" optional helper="Remembered on this device">
            {(p) => <DoneBySelect id={p.id} team={data.team} value={doneBy} onChange={setDoneBy} />}
          </Field>
          <Field label="Supplier bill no." optional helper="e.g. DRP/2026/889">
            {(p) => <Input {...p} value={billNo} onChange={(e) => setBillNo(e.target.value)} maxLength={60} />}
          </Field>
          <Field label="Bill date" optional>
            {(p) => <Input {...p} type="date" max={data.today} value={billDate} onChange={(e) => setBillDate(e.target.value)} />}
          </Field>
          <Field label="Upload the bill" optional className="md:col-span-2">
            {(p) => <FileField id={p.id} kind="BILL" env={uploadEnv} value={bill} onChange={setBill} onBusyChange={setUploading} />}
          </Field>
          <Field label="Note" optional className="md:col-span-2">
            {(p) => <Textarea {...p} rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />}
          </Field>
        </div>
      </FormSection>

      <section className="flex flex-col gap-3" aria-label="Items received">
        <h2 className="text-lg font-semibold">Items received</h2>
        {lines.map((l, n) => {
          const item = itemOf(l.itemId);
          const m = lineMath(l, item);
          const pack = item?.packSize && D(item.packSize).gt(0) ? item : null;
          return (
            <div key={l.key} className="rounded-2xl border bg-card p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-muted-foreground">Line {n + 1}</span>
                {lines.length > 1 ? (
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove line ${n + 1}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                    <Trash2 aria-hidden />
                  </Button>
                ) : null}
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <ItemPicker items={data.items} value={l.itemId} onChange={(id) => pickItem(l.key, id)} invalid={tried && !l.itemId && lines.length === 1} />
                </div>
                {item ? (
                  <>
                    <Field label="Quantity received" required helper={pack && l.inPacks && parseQty(l.qty) ? packText(parseQty(l.qty)!, pack.packName!, pack.packSize!, item.unit) : undefined}>
                      {(p) => (
                        <div className="flex gap-2">
                          <Input {...p} inputMode="decimal" value={l.qty} onChange={(e) => update(l.key, { qty: e.target.value })} className="min-w-0 flex-1" />
                          {pack ? <Toggle a={item.unit} b={plural(pack.packName!)} bOn={l.inPacks} onChange={(v) => update(l.key, { inPacks: v, ratePerPack: v })} label="Enter quantity in" /> : <span className="self-center text-muted-foreground">{item.unit}</span>}
                        </div>
                      )}
                    </Field>
                    <Field label={`Rate before GST, per ${l.ratePerPack && pack ? pack.packName!.toLowerCase() : item.unit}`} required helper="Enter the rate without GST">
                      {(p) => (
                        <div className="flex gap-2">
                          <div className="flex min-w-0 flex-1 items-center rounded-xl border bg-card focus-within:ring-2 focus-within:ring-ring">
                            <span className="pl-3 text-muted-foreground">₹</span>
                            <Input {...p} inputMode="decimal" value={l.rate} onChange={(e) => update(l.key, { rate: e.target.value })} className="border-0 shadow-none focus-visible:ring-0" />
                          </div>
                          {pack ? <Toggle a={`per ${item.unit}`} b={`per ${pack.packName!.toLowerCase()}`} bOn={l.ratePerPack} onChange={(v) => update(l.key, { ratePerPack: v })} label="Rate is" /> : null}
                        </div>
                      )}
                    </Field>
                    {item.trackBatches ? (
                      <>
                        <Field label="Batch no." required helper="From the label, e.g. R-2611-04">
                          {(p) => <Input {...p} value={l.batchNo} onChange={(e) => update(l.key, { batchNo: e.target.value })} maxLength={40} />}
                        </Field>
                        <Field label="Expiry date" required>
                          {(p) => <Input {...p} type="date" value={l.expiryDate} onChange={(e) => update(l.key, { expiryDate: e.target.value })} />}
                        </Field>
                      </>
                    ) : null}
                    <p className="text-sm text-muted-foreground md:col-span-2">
                      {m ? (
                        <>
                          {formatQty(m.units, item.unit)} at ₹{Number(m.unitRate).toLocaleString("en-IN", { maximumFractionDigits: 4 })} per {item.unit} ={" "}
                          <strong className="text-foreground">{formatINR(m.total)}</strong>
                        </>
                      ) : (
                        <>In stock now: {formatQty(item.qty, item.unit)}</>
                      )}
                    </p>
                  </>
                ) : null}
              </div>
            </div>
          );
        })}
        <Button type="button" variant="outline" className="self-start" onClick={() => setLines((ls) => [...ls, blankLine()])}>
          <Plus aria-hidden /> Add another item
        </Button>
      </section>

      <div className="sticky bottom-20 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card/95 p-4 shadow-lg backdrop-blur md:bottom-4">
        <p>
          Total before GST: <strong className="tabular-nums">{formatINR(total)}</strong>
        </p>
        <Button onClick={save} disabled={pending || uploading}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />} Save stock received
        </Button>
      </div>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add new supplier</DialogTitle>
          </DialogHeader>
          {adding ? (
            <SupplierForm
              supplierId={null}
              initial={EMPTY_SUPPLIER_FORM}
              onCancel={() => setAdding(false)}
              onSaved={(s) => {
                setSuppliers((list) => [...list, s].sort((a, b) => a.name.localeCompare(b.name)));
                setSupplierId(s.id);
                setAdding(false);
                router.refresh();
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function plural(w: string) {
  const l = w.toLowerCase();
  return /(s|x|ch|sh)$/.test(l) ? `${l}es` : `${l}s`;
}

/** Two-way switch, e.g. [ml | bottles]. */
export function Toggle({ a, b, bOn, onChange, label }: { a: string; b: string; bOn: boolean; onChange: (bOn: boolean) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex shrink-0 rounded-xl border bg-secondary p-1">
      {[a, b].map((t, i) => {
        const on = i === 1 ? bOn : !bOn;
        return (
          <button key={t} type="button" aria-pressed={on} onClick={() => onChange(i === 1)} className={cn("h-9 rounded-lg px-3 text-sm font-medium whitespace-nowrap", on ? "bg-card text-primary shadow-sm" : "text-muted-foreground")}>
            {t}
          </button>
        );
      })}
    </div>
  );
}
