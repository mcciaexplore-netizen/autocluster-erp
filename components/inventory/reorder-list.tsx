"use client";

import { FileSpreadsheet, FileText, Loader2, Mail, MessageCircle, Send, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Field } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { clearOrderedAction, markOrderedAction } from "@/lib/actions/reorder";
import { formatDate } from "@/lib/format";
import type { ReorderData, ReorderItem } from "@/lib/inventory-data";
import { D, formatQty, formatRate, packWord, parseQty, valuePaise } from "@/lib/inventory/numbers";
import { orderListQuery } from "@/lib/inventory/order-params";
import { orderLinks, type OrderLine } from "@/lib/inventory/reorder";
import { todayInIndia } from "@/lib/tickets";
import { formatINR, formatINRShort } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import { runsOutText } from "./items-list";
import { DoneBySelect, useDoneBy } from "./pickers";

type Team = { id: string; name: string }[];
type Supplier = ReorderData["suppliers"][number];

const dayMonth = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" });
const orderedText = (i: ReorderItem) => `Ordered on ${dayMonth.format(new Date(`${i.orderedOn}T00:00:00`))}${i.orderedSupplier ? ` from ${i.orderedSupplier}` : ""}`;

/** Items with a pack size are ordered in packs; the rest in the item's unit. */
const inPacks = (i: ReorderItem) => !!i.packName && D(i.packSize).gt(0);
const initialText = (i: ReorderItem) => (inPacks(i) ? D(i.suggestedQty).div(D(i.packSize)).toFixed() : D(i.suggestedQty).toFixed());
function unitsOf(i: ReorderItem, text: string): string | null {
  const q = parseQty(text);
  if (q == null || D(q).lte(0)) return null;
  return inPacks(i) ? D(q).mul(D(i.packSize)).toFixed() : q;
}

export function ReorderList({ data, team }: { data: ReorderData; team: Team }) {
  // Items marked "Ordered on" start unticked, so nobody orders them twice.
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [qty, setQty] = useState<Record<string, string>>({});
  const isTicked = (i: ReorderItem) => ticked[i.id] ?? !i.orderedOn;
  const text = (i: ReorderItem) => qty[i.id] ?? initialText(i);

  return (
    <div className="flex flex-col gap-6">
      {data.groups.map((g) => {
        const chosen = g.items.filter(isTicked);
        const bad = chosen.filter((i) => unitsOf(i, text(i)) == null);
        const noRate = chosen.filter((i) => !i.rate).length;
        const est = chosen.reduce((a, i) => {
          const u = unitsOf(i, text(i));
          return a + (u && i.rate ? valuePaise(u, i.rate) : 0);
        }, 0);
        return (
          <section key={g.supplier?.id ?? "none"} className="rounded-2xl border bg-card">
            <header className="flex flex-col gap-1 border-b px-4 py-3.5 sm:px-5">
              <h2 className="text-lg font-semibold">
                {g.supplier ? (
                  <Link href={`/inventory/suppliers/${g.supplier.id}`} className="hover:text-primary hover:underline">
                    {g.supplier.name}
                  </Link>
                ) : (
                  "No preferred supplier"
                )}
              </h2>
              <p className="text-sm text-muted-foreground">
                {g.supplier ? [g.supplier.contactName, g.supplier.phone, g.supplier.email].filter(Boolean).join(" · ") || "No contact details yet" : "Choose a supplier when you send. Set a preferred supplier on the item to group it here next time."}
              </p>
            </header>
            <ul className="divide-y">
              {g.items.map((i) => {
                const t = text(i);
                const units = unitsOf(i, t);
                const on = isTicked(i);
                return (
                  <li key={i.id} className={cn("flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:px-5", !on && "bg-secondary/40")}>
                    <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                      <span className="grid size-11 shrink-0 place-items-center -m-2.5">
                        <Checkbox checked={on} onCheckedChange={(v) => setTicked((s) => ({ ...s, [i.id]: v === true }))} aria-label={`Order ${i.name}`} />
                      </span>
                      <span className="min-w-0">
                        <span className="block font-semibold">{i.name}</span>
                        <span className="block text-sm text-muted-foreground">
                          {i.code} · {Number(i.qty) > 0 ? `Stock ${formatQty(i.qty, i.unit)} · Runs out in ${runsOutText(i.runsOutDays, i.qty)}` : "Out of stock"}
                        </span>
                        <span className="mt-1 flex flex-wrap gap-1.5">
                          {i.belowLevel ? (
                            <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-800 ring-1 ring-red-200">At or below reorder level ({formatQty(i.reorderLevel, i.unit)})</span>
                          ) : (
                            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900 ring-1 ring-amber-200">
                              Runs out before new stock arrives ({i.leadTimeDays ?? 0} days lead time + {data.safetyDays} safety)
                            </span>
                          )}
                          {i.orderedOn ? <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-900 ring-1 ring-sky-200">{orderedText(i)}</span> : null}
                        </span>
                      </span>
                    </label>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pl-9 sm:pl-0">
                      {i.orderedOn ? <ClearOrdered item={i} /> : null}
                      <div className="flex flex-col">
                        <label className="flex items-center gap-2">
                          <span className="sr-only">Quantity to order of {i.name}</span>
                          <Input
                            inputMode="decimal"
                            value={t}
                            onChange={(e) => setQty((s) => ({ ...s, [i.id]: e.target.value }))}
                            aria-invalid={on && units == null ? true : undefined}
                            disabled={!on}
                            className="h-11 w-24 text-right text-base font-semibold tabular-nums"
                          />
                          <span className="text-sm text-muted-foreground">{inPacks(i) ? `${packWord(parseQty(t) ?? 2, i.packName!)} of ${formatQty(i.packSize, i.unit)}` : i.unit}</span>
                        </label>
                        {on && units == null ? <span className="text-xs text-destructive">Enter the quantity</span> : inPacks(i) && units ? <span className="text-xs text-muted-foreground">= {formatQty(units, i.unit)}</span> : null}
                      </div>
                      <div className="w-36 text-right text-sm">
                        <span className="block font-semibold tabular-nums">{units && i.rate ? formatINRShort(valuePaise(units, i.rate)) : "-"}</span>
                        <span className="block text-muted-foreground">{i.rate ? `Last rate ${formatRate(i.rate)}/${i.unit}` : "No rate yet"}</span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            <footer className="flex flex-col gap-3 border-t px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <p className="text-sm">
                <span className="font-semibold">
                  {chosen.length} of {g.items.length} ticked
                </span>
                {chosen.length ? (
                  <span className="text-muted-foreground">
                    {" · "}
                    {est > 0 ? `estimated ${formatINR(est)} before GST` : "no rates yet to estimate"}
                    {est > 0 && noRate ? ` (${noRate} without a rate)` : ""}
                  </span>
                ) : null}
              </p>
              <SendButton
                supplier={g.supplier}
                suppliers={data.suppliers}
                team={team}
                templates={data.templates}
                orgName={data.orgName}
                disabled={!chosen.length || bad.length > 0}
                lines={chosen.map((i) => ({ item: i, units: unitsOf(i, text(i)) ?? "0" }))}
                onSent={() => setTicked((s) => ({ ...s, ...Object.fromEntries(chosen.map((i) => [i.id, false])) }))}
              />
            </footer>
          </section>
        );
      })}
    </div>
  );
}

function ClearOrdered({ item }: { item: ReorderItem }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await clearOrderedAction(item.id);
          if (!r.ok) return void toast.error(r.message);
          toast.success(`"Ordered" mark cleared for ${item.name}`);
          router.refresh();
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : <X aria-hidden />} Clear ordered mark
    </Button>
  );
}

/** Opens a link (or downloads a file) from a click, without leaving the page for downloads. */
function openLink(href: string, o: { newTab?: boolean; download?: boolean } = {}) {
  const a = document.createElement("a");
  a.href = href;
  if (o.newTab) {
    a.target = "_blank";
    a.rel = "noopener";
  }
  if (o.download) a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function SendButton({
  supplier,
  suppliers,
  team,
  templates,
  orgName,
  disabled,
  lines,
  onSent,
}: {
  supplier: Supplier | null;
  suppliers: Supplier[];
  team: Team;
  templates: ReorderData["templates"];
  orgName: string;
  disabled: boolean;
  lines: { item: ReorderItem; units: string }[];
  onSent: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState(supplier?.id ?? "");
  const [doneBy, setDoneBy] = useDoneBy(team);
  const [pending, start] = useTransition();
  const sup = suppliers.find((s) => s.id === picked) ?? null;
  const orderLines: OrderLine[] = lines.map((l) => ({ name: l.item.name, qty: l.units, unit: l.item.unit, packName: l.item.packName, packSize: l.item.packSize }));
  const today = todayInIndia();
  const links = sup ? orderLinks(sup, orderLines, templates, { orgName, date: formatDate(today) }) : null;
  const query = orderListQuery(sup?.id ?? null, lines.map((l) => ({ itemId: l.item.id, qty: l.units })));

  function send(method: "WHATSAPP" | "EMAIL" | "PDF" | "EXCEL") {
    if (!sup || !links) return;
    // Open the link straight away (in the same tap), so the browser doesn't block it.
    if (method === "WHATSAPP" && links.whatsappUrl) openLink(links.whatsappUrl, { newTab: true });
    if (method === "EMAIL" && links.mailtoUrl) openLink(links.mailtoUrl);
    if (method === "PDF" || method === "EXCEL") openLink(`/api/inventory/reorder/${method === "PDF" ? "pdf" : "excel"}?${query}`, { download: true });
    start(async () => {
      const r = await markOrderedAction({ supplierId: sup.id, method, doneBy: doneBy || null, lines: lines.map((l) => ({ itemId: l.item.id, qty: l.units })) });
      if (!r.ok) return void toast.error(r.message);
      toast.success(`${r.data.items} ${r.data.items === 1 ? "item" : "items"} marked "Ordered on ${dayMonth.format(new Date(`${r.data.orderedOn}T00:00:00`))}" from ${r.data.supplier}`);
      setOpen(false);
      onSent();
      router.refresh();
    });
  }

  const ACTIONS = [
    { m: "WHATSAPP", label: "WhatsApp", icon: MessageCircle, ok: !!links?.whatsappUrl, why: "No mobile number for this supplier" },
    { m: "EMAIL", label: "Email", icon: Mail, ok: !!links?.mailtoUrl, why: "No email for this supplier" },
    { m: "PDF", label: "Download PDF", icon: FileText, ok: !!sup, why: "" },
    { m: "EXCEL", label: "Download Excel", icon: FileSpreadsheet, ok: !!sup, why: "" },
  ] as const;

  return (
    <>
      <Button size="lg" disabled={disabled} onClick={() => setOpen(true)}>
        <Send aria-hidden /> Send to supplier
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Send to supplier</DialogTitle>
            <DialogDescription>
              {lines.length} {lines.length === 1 ? "item" : "items"}. Sending marks {lines.length === 1 ? "it" : "them"} &ldquo;Ordered on {dayMonth.format(new Date(`${today}T00:00:00`))}&rdquo; so nobody orders twice. The mark clears when the stock is received from this supplier.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <Field label="Supplier" required error={!sup ? "Please choose the supplier." : undefined}>
              {(p) => (
                <Select value={picked} onValueChange={setPicked}>
                  <SelectTrigger id={p.id} className="w-full" aria-invalid={p["aria-invalid"]}>
                    <SelectValue placeholder="Choose the supplier" />
                  </SelectTrigger>
                  <SelectContent>
                    {suppliers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
            {links ? (
              <div>
                <p className="mb-1.5 text-sm font-medium">Message</p>
                <pre className="max-h-48 overflow-y-auto rounded-xl border bg-secondary/50 p-3 font-sans text-sm whitespace-pre-wrap">{links.message}</pre>
              </div>
            ) : null}
            <Field label="Done by" optional>
              {(p) => <DoneBySelect id={p.id} team={team} value={doneBy} onChange={setDoneBy} />}
            </Field>
            <div className="grid grid-cols-2 gap-2">
              {ACTIONS.map(({ m, label, icon: Icon, ok, why }) => (
                <div key={m} className="flex flex-col">
                  <Button variant={m === "WHATSAPP" ? "default" : "outline"} className="h-12" disabled={!ok || pending} onClick={() => send(m)}>
                    {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Icon aria-hidden />} {label}
                  </Button>
                  {sup && !ok && why ? <span className="mt-1 text-xs text-muted-foreground">{why}</span> : null}
                </div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
