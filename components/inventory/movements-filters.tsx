"use client";

import { Download, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const ALL = "all";

export function MovementsFilters({
  items,
  suppliers,
  team,
  ticketLabel,
}: {
  items: { id: string; name: string }[];
  suppliers: { id: string; name: string }[];
  team: { id: string; name: string }[];
  ticketLabel?: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, start] = useTransition();
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    const qs = next.toString();
    start(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };
  const keys = ["type", "item", "supplier", "ticket", "doneBy", "from", "to"];
  const any = keys.some((k) => params.get(k));
  const pick = (key: string, label: string, all: string, options: { value: string; label: string }[]) => {
    const v = params.get(key);
    return (
      <div className="min-w-0">
        <label htmlFor={`m-${key}`} className="sr-only">
          {label}
        </label>
        <Select value={v ?? ALL} onValueChange={(x) => set({ [key]: x === ALL ? null : x })}>
          <SelectTrigger id={`m-${key}`} size="sm" aria-label={label} className={cn("h-10 w-full text-sm lg:w-auto lg:min-w-40", v && "border-primary bg-primary/5 font-medium text-primary")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-80">
            <SelectItem value={ALL}>{all}</SelectItem>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  };
  const qs = keys
    .filter((k) => params.get(k))
    .map((k) => `${k}=${encodeURIComponent(params.get(k)!)}`)
    .join("&");
  return (
    <div className="mb-5 flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-center">
        {pick("type", "Type", "All types", [
          { value: "IN", label: "Stock received" },
          { value: "OUT", label: "Stock used" },
          { value: "ADJ", label: "Stock adjusted" },
        ])}
        {pick("item", "Item", "All items", items.map((i) => ({ value: i.id, label: i.name })))}
        {pick("supplier", "Supplier", "All suppliers", suppliers.map((s) => ({ value: s.id, label: s.name })))}
        {pick("doneBy", "Done by", "Anyone", team.map((t) => ({ value: t.id, label: t.name })))}
        <div className="flex min-w-0 items-center gap-2">
          <label htmlFor="m-from" className="text-sm whitespace-nowrap text-muted-foreground">
            From
          </label>
          <Input id="m-from" type="date" className="h-10 min-w-0" value={params.get("from") ?? ""} onChange={(e) => set({ from: e.target.value || null })} />
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <label htmlFor="m-to" className="text-sm whitespace-nowrap text-muted-foreground">
            To
          </label>
          <Input id="m-to" type="date" className="h-10 min-w-0" value={params.get("to") ?? ""} onChange={(e) => set({ to: e.target.value || null })} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {params.get("ticket") ? (
          <button type="button" onClick={() => set({ ticket: null })} className="inline-flex h-10 items-center gap-1.5 rounded-full border border-primary bg-primary px-4 text-sm font-medium text-primary-foreground">
            Ticket {ticketLabel ?? ""} <X className="size-3.5" aria-hidden />
          </button>
        ) : null}
        {any ? (
          <button type="button" onClick={() => set(Object.fromEntries(keys.map((k) => [k, null])))} className="inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-primary hover:underline">
            <X className="size-4" aria-hidden /> Clear filters
          </button>
        ) : null}
        <Button asChild variant="outline" className="ml-auto">
          <a href={`/api/inventory/movements/export${qs ? `?${qs}` : ""}`} download data-skip-unsaved>
            <Download aria-hidden /> Download as Excel
          </a>
        </Button>
      </div>
    </div>
  );
}
