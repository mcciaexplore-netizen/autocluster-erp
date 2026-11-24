"use client";

import { FlaskConical, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { setServiceMaterialsAction } from "@/lib/actions/inventory";
import { billingUnitName } from "@/lib/inventory/materials";
import { ItemPicker } from "./pickers";

export type PickItem = { id: string; name: string; code: string; qty: string; unit: string };
let seq = 0;

/** Rate Card > "Materials used": the items a service uses, and how much per billing unit. */
export function MaterialsButton({
  service,
  current,
  items,
  readOnly = false,
}: {
  service: { id: number; name: string; unitLabel: string };
  current: { itemId: string; qtyPerUnit: string }[];
  items: PickItem[];
  /** People who may not change materials lists see the count only. */
  readOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (readOnly)
    return (
      <span className="inline-flex h-8 items-center gap-1 text-xs text-muted-foreground">
        <FlaskConical className="size-3.5" aria-hidden /> Materials used{current.length ? ` (${current.length})` : ""}
      </span>
    );
  return (
    <>
      <Button type="button" variant="ghost" size="sm" className="-ml-2 h-8 px-2 text-xs font-normal text-primary" onClick={() => setOpen(true)}>
        <FlaskConical className="size-3.5" aria-hidden /> Materials used{current.length ? ` (${current.length})` : ""}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">{open ? <Body service={service} current={current} items={items} onDone={() => setOpen(false)} /> : null}</DialogContent>
      </Dialog>
    </>
  );
}

function Body({ service, current, items, onDone }: { service: { id: number; name: string; unitLabel: string }; current: { itemId: string; qtyPerUnit: string }[]; items: PickItem[]; onDone: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const per = billingUnitName(service.unitLabel);
  const [lines, setLines] = useState(() =>
    current.length ? current.map((c) => ({ key: ++seq, itemId: c.itemId, qtyPerUnit: String(Number(c.qtyPerUnit)) })) : [{ key: ++seq, itemId: "", qtyPerUnit: "" }],
  );
  const update = (key: number, patch: Partial<(typeof lines)[number]>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const save = () =>
    start(async () => {
      const r = await setServiceMaterialsAction(
        service.id,
        lines.filter((l) => l.itemId).map((l) => ({ itemId: l.itemId, qtyPerUnit: l.qtyPerUnit })),
      );
      if (!r.ok) return void toast.error(r.message);
      toast.success(r.data.count ? `Materials saved for ${service.name}` : `Materials list cleared for ${service.name}`);
      router.refresh();
      onDone();
    });
  return (
    <div className="flex flex-col gap-5">
      <DialogHeader>
        <DialogTitle>Materials used: {service.name}</DialogTitle>
        <DialogDescription>
          List the items this service uses and how much per {per} (include supports and waste). These only suggest quantities when stock is used for a job; staff always confirm.
        </DialogDescription>
      </DialogHeader>
      <ul className="flex flex-col gap-3">
        {lines.map((l, n) => {
          const item = items.find((i) => i.id === l.itemId);
          return (
            <li key={l.key} className="grid grid-cols-1 gap-2 rounded-xl border p-3 sm:grid-cols-[minmax(0,1fr)_11rem_auto] sm:items-center">
              <ItemPicker items={items} value={l.itemId} onChange={(id) => update(l.key, { itemId: id })} label={`Item, line ${n + 1}`} />
              <div className="flex items-center gap-2">
                <Input aria-label={`Amount per ${per}, line ${n + 1}`} inputMode="decimal" placeholder="e.g. 1.15" value={l.qtyPerUnit} onChange={(e) => update(l.key, { qtyPerUnit: e.target.value })} className="min-w-0" />
                <span className="text-sm whitespace-nowrap text-muted-foreground">
                  {item?.unit ?? ""} per {per}
                </span>
              </div>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove line ${n + 1}`} onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : [{ key: ++seq, itemId: "", qtyPerUnit: "" }]))}>
                <Trash2 aria-hidden />
              </Button>
            </li>
          );
        })}
      </ul>
      <Button type="button" variant="outline" className="self-start" onClick={() => setLines((ls) => [...ls, { key: ++seq, itemId: "", qtyPerUnit: "" }])}>
        <Plus aria-hidden /> Add an item
      </Button>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="button" onClick={save} disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />} Save materials
        </Button>
      </DialogFooter>
    </div>
  );
}
