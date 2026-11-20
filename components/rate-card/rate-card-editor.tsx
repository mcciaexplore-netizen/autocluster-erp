"use client";

import { Check, Info, Pencil, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { setServiceActive, updateRates } from "@/lib/actions/rate-card";
import { DeptIcon } from "@/components/customers/dept-icons";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { MaterialsButton, type PickItem } from "@/components/inventory/materials-dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { Department, Service } from "@/db/schema";
import { useUnsavedChangesWarning } from "@/hooks/use-unsaved-changes";
import { formatDate } from "@/lib/format";
import { formatINRShort, toPaise, UNIT_LABELS } from "@/lib/pricing";
import { cn } from "@/lib/utils";

type Edit = { msme: string; oem: string };

export function RateCardEditor({
  departments,
  services,
  materials = {},
  items = [],
}: {
  departments: Department[];
  services: Service[];
  /** Materials list per service (Inventory). */
  materials?: Record<number, { itemId: string; qtyPerUnit: string }[]>;
  items?: PickItem[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState<Record<number, Edit>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const startEditing = () => {
    setEdits(Object.fromEntries(services.map((s) => [s.id, { msme: String(Number(s.rateMsme)), oem: String(Number(s.rateOem)) }])));
    setEditing(true);
  };

  const changes = useMemo(
    () =>
      services
        .filter((s) => {
          const e = edits[s.id];
          return e && (toPaise(e.msme || 0) !== toPaise(s.rateMsme) || toPaise(e.oem || 0) !== toPaise(s.rateOem));
        })
        .map((s) => ({ service: s, msme: Number(edits[s.id].msme), oem: Number(edits[s.id].oem) })),
    [edits, services],
  );
  const invalid = editing && Object.values(edits).some((e) => !(e.msme.trim() !== "" && Number(e.msme) >= 0 && e.oem.trim() !== "" && Number(e.oem) >= 0));

  useUnsavedChangesWarning(editing && changes.length > 0);

  const save = () =>
    startTransition(async () => {
      const res = await updateRates(changes.map((c) => ({ id: c.service.id, rateMsme: c.msme, rateOem: c.oem })));
      setConfirmOpen(false);
      if (!res.ok) return void toast.error(res.message);
      toast.success(`Rates saved (${changes.length} ${changes.length === 1 ? "service" : "services"} changed)`);
      setEditing(false);
      router.refresh();
    });

  const toggleActive = (s: Service, on: boolean) =>
    startTransition(async () => {
      await setServiceActive(s.id, on);
      toast.success(on ? `${s.name} is offered again` : `${s.name} is hidden from new quotations`);
      router.refresh();
    });

  return (
    <>
      <div className="mb-6 flex flex-col gap-3 rounded-2xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-start gap-2 text-muted-foreground">
          <Info className="mt-0.5 size-5 shrink-0" aria-hidden />
          {editing
            ? "Type the new rates. Changes apply to new quotations only. Saved quotations keep their rates."
            : "Members get the member discount taken off these rates automatically. Switch a service off to hide it from forms."}
        </p>
        {editing ? (
          <div className="flex shrink-0 gap-3">
            <Button variant="outline" onClick={() => setEditing(false)}>
              <X aria-hidden /> Cancel
            </Button>
            <Button onClick={() => (changes.length ? setConfirmOpen(true) : setEditing(false))} disabled={invalid}>
              <Check aria-hidden /> Save rates{changes.length ? ` (${changes.length})` : ""}
            </Button>
          </div>
        ) : (
          <Button size="lg" onClick={startEditing} className="shrink-0">
            <Pencil aria-hidden /> Edit rates
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-6">
        {departments.map((d) => {
          const list = services.filter((s) => s.deptCode === d.code);
          return (
            <section key={d.code} className="rounded-2xl border bg-card" aria-labelledby={`rc-${d.code}`}>
              <h2 id={`rc-${d.code}`} className="flex items-center gap-3 border-b px-5 py-4 text-lg font-semibold">
                <span className="grid size-9 place-items-center rounded-lg bg-secondary text-primary">
                  <DeptIcon code={d.code} className="size-5" />
                </span>
                {d.code} - {d.name}
              </h2>
              <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_8rem_8rem_8rem_6rem] gap-3 px-5 pt-3 text-sm font-medium text-muted-foreground md:grid">
                <span>Service / machine</span>
                <span>Charged</span>
                <span className="text-right">MSME rate</span>
                <span className="text-right">OEM / Tier 1-2 rate</span>
                <span>Effective from</span>
                <span>Active</span>
              </div>
              <ul className="divide-y">
                {list.map((s) => {
                  const e = edits[s.id];
                  const changed = changes.some((c) => c.service.id === s.id);
                  return (
                    <li
                      key={s.id}
                      className={cn(
                        "grid grid-cols-2 items-center gap-3 px-5 py-3.5 md:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_8rem_8rem_8rem_6rem]",
                        !s.isActive && "bg-muted/50 text-muted-foreground",
                        changed && "bg-highlight/10",
                      )}
                    >
                      <span className="col-span-2 font-medium md:col-span-1">
                        {s.name}
                        {!s.isActive ? <span className="ml-2 text-sm font-normal">(hidden)</span> : null}
                        <span className="block">
                          <MaterialsButton service={{ id: s.id, name: s.name, unitLabel: s.unitLabel }} current={materials[s.id] ?? []} items={items} />
                        </span>
                      </span>
                      <span className="col-span-2 text-sm text-muted-foreground md:col-span-1">{UNIT_LABELS[s.unitType]}</span>
                      {(["msme", "oem"] as const).map((k) => (
                        <div key={k} className="md:text-right">
                          <span className="block text-xs text-muted-foreground md:hidden">{k === "msme" ? "MSME rate" : "OEM / Tier 1-2 rate"}</span>
                          {editing && e ? (
                            <div className="relative">
                              <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">₹</span>
                              <Input
                                type="number"
                                min={0}
                                step="any"
                                inputMode="decimal"
                                aria-label={`${k === "msme" ? "MSME" : "OEM / Tier 1-2"} rate for ${s.name}`}
                                value={e[k]}
                                onChange={(ev) => setEdits((cur) => ({ ...cur, [s.id]: { ...cur[s.id], [k]: ev.target.value } }))}
                                aria-invalid={!(e[k].trim() !== "" && Number(e[k]) >= 0)}
                                className="pl-7 text-right tabular-nums"
                              />
                            </div>
                          ) : (
                            <span className="font-semibold tabular-nums">{formatINRShort(toPaise(k === "msme" ? s.rateMsme : s.rateOem))}</span>
                          )}
                        </div>
                      ))}
                      <span className="text-sm">
                        <span className="block text-xs text-muted-foreground md:hidden">Effective from</span>
                        {formatDate(s.effectiveFrom)}
                      </span>
                      <label className="flex items-center gap-2 text-sm">
                        <Switch checked={s.isActive} onCheckedChange={(on) => toggleActive(s, on)} disabled={pending} aria-label={`Offer ${s.name}`} />
                        <span className="md:sr-only">{s.isActive ? "Offered" : "Hidden"}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Save the new rates?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="text-base">
                <p className="mb-3">These rates will be used for new quotations from today. Quotations already made will not change.</p>
                <ul className="max-h-60 space-y-1.5 overflow-y-auto text-sm text-foreground">
                  {changes.map(({ service: s, msme, oem }) => (
                    <li key={s.id}>
                      <strong>{s.name}</strong>: MSME {formatINRShort(toPaise(s.rateMsme))} → {formatINRShort(toPaise(msme))}, OEM{" "}
                      {formatINRShort(toPaise(s.rateOem))} → {formatINRShort(toPaise(oem))}
                    </li>
                  ))}
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(ev) => {
                ev.preventDefault();
                save();
              }}
            >
              Yes, save rates
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
