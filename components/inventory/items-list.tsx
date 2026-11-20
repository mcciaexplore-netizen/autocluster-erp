"use client";

import { Package, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { EmptyState } from "@/components/common/empty-state";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ItemRow } from "@/lib/inventory-data";
import { formatQty } from "@/lib/inventory/numbers";
import { runsOutText, STATUS_CHIP } from "@/lib/inventory/stock";
import { formatINRShort } from "@/lib/pricing";
import { cn } from "@/lib/utils";

const ALL = "all";
const STATUS_FILTERS = { in: "In stock", low: "Low", out: "Out of stock", expiring: "Expiring soon" } as const;

export function StatusChips({ status, expiring }: { status: ItemRow["status"]; expiring: boolean }) {
  const c = STATUS_CHIP[status];
  return (
    <span className="inline-flex flex-wrap gap-1">
      <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", c.className)}>{c.label}</span>
      {expiring ? <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", STATUS_CHIP.expiring.className)}>{STATUS_CHIP.expiring.label}</span> : null}
    </span>
  );
}


export function ItemsList({
  items,
  categories,
  departments,
  runsOut = {},
}: {
  items: ItemRow[];
  categories: { id: string; name: string }[];
  departments: { code: string; name: string }[];
  runsOut?: Record<string, number | null>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };
  const [q, setQ] = useState(params.get("q") ?? "");
  useEffect(() => {
    const t = setTimeout(() => (params.get("q") ?? "") !== q.trim() && set({ q: q.trim() || null }), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const f = {
    q: (params.get("q") ?? "").toLowerCase(),
    category: params.get("category"),
    dept: params.get("dept"),
    status: params.get("status") as keyof typeof STATUS_FILTERS | null,
    batches: params.get("batches") === "1",
    inactive: params.get("inactive") === "1",
  };
  const rows = useMemo(
    () =>
      items.filter((i) => {
        if (!f.inactive && !i.isActive) return false;
        if (f.category && i.categoryId !== f.category) return false;
        if (f.dept && !i.depts.includes(f.dept)) return false;
        if (f.batches && !i.trackBatches) return false;
        if (f.status === "expiring" ? !i.expiringSoon : f.status && i.status !== f.status) return false;
        if (f.q && !`${i.name} ${i.code}`.toLowerCase().includes(f.q)) return false;
        return true;
      }),
    [items, f.inactive, f.category, f.dept, f.batches, f.status, f.q],
  );
  const any = !!(f.q || f.category || f.dept || f.status || f.batches || f.inactive);

  const select = (key: string, label: string, value: string | null, all: string, options: { value: string; label: string }[]) => (
    <div className="min-w-0">
      <label htmlFor={`f-${key}`} className="sr-only">
        {label}
      </label>
      <Select value={value ?? ALL} onValueChange={(v) => set({ [key]: v === ALL ? null : v })}>
        <SelectTrigger id={`f-${key}`} size="sm" aria-label={label} className={cn("h-10 w-full text-sm lg:w-auto lg:min-w-40", value && "border-primary bg-primary/5 font-medium text-primary")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
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
  const toggle = (key: string, on: boolean, label: string) => (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => set({ [key]: on ? null : "1" })}
      className={cn("inline-flex h-10 items-center rounded-full border px-4 text-sm font-medium", on ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-primary/40")}
    >
      {label}
    </button>
  );

  return (
    <>
      <div className="mb-5 flex flex-col gap-3">
        <div className="relative">
          <label htmlFor="item-search" className="sr-only">
            Search items
          </label>
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input id="item-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by item name or code" className="h-12 pl-11" />
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-center">
          {select("category", "Category", f.category, "All categories", categories.map((c) => ({ value: c.id, label: c.name })))}
          {select("dept", "Department", f.dept, "All departments", departments.map((d) => ({ value: d.code, label: d.code })))}
          {select("status", "Stock status", f.status, "Any stock status", Object.entries(STATUS_FILTERS).map(([value, label]) => ({ value, label })))}
          <div className="flex flex-wrap gap-2">
            {toggle("batches", f.batches, "Has batches")}
            {toggle("inactive", f.inactive, "Show inactive")}
            {any ? (
              <button
                type="button"
                onClick={() => {
                  setQ("");
                  set({ q: null, category: null, dept: null, status: null, batches: null, inactive: null });
                }}
                className="inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-primary hover:underline"
              >
                <X className="size-4" aria-hidden /> Clear filters
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {!items.length ? (
        <EmptyState icon={Package} title="No items yet" description="Add the materials and consumables you keep, e.g. resins, coolant, gloves and lamps." />
      ) : !rows.length ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">No items match these filters.</p>
      ) : (
        <>
          {/* Desktop: table */}
          <div className="hidden overflow-x-auto rounded-2xl border bg-card lg:block">
            <table className="w-full text-sm">
              <caption className="sr-only">Items</caption>
              <thead className="border-b bg-secondary/50 text-left text-muted-foreground">
                <tr>
                  {["Item code", "Name", "Category", "Department", "Stock", "Status", "Stock value", "Reorder level", "Runs out in"].map((h, i) => (
                    <th key={h} scope="col" className={cn("px-3 py-2.5 font-medium whitespace-nowrap", (i === 4 || i === 6 || i === 7) && "text-right")}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.id} className={cn("border-b last:border-0 hover:bg-secondary/30", !i.isActive && "text-muted-foreground")}>
                    <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">{i.code}</td>
                    <td className="px-3 py-2.5 font-medium">
                      <Link href={`/inventory/items/${i.id}`} className="hover:text-primary hover:underline">
                        {i.name}
                      </Link>
                      {!i.isActive ? <span className="ml-2 text-xs">(inactive)</span> : null}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{i.categoryName}</td>
                    <td className="px-3 py-2.5">
                      <span className="flex flex-wrap gap-1">
                        {i.depts.map((d) => (
                          <span key={d} className="rounded-full border bg-secondary px-2 py-0.5 text-xs font-medium text-primary">
                            {d}
                          </span>
                        ))}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium whitespace-nowrap tabular-nums">{formatQty(i.qty, i.unit)}</td>
                    <td className="px-3 py-2.5">
                      <StatusChips status={i.status} expiring={i.expiringSoon} />
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap tabular-nums">{formatINRShort(i.valuePaise)}</td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap tabular-nums">{formatQty(i.reorderLevel, i.unit)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{runsOutText(runsOut[i.id], i.qty)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Phone and tablet: cards */}
          <ul className="flex flex-col gap-3 lg:hidden">
            {rows.map((i) => (
              <li key={i.id}>
                <Link href={`/inventory/items/${i.id}`} className={cn("block rounded-xl border bg-card p-4 hover:border-primary/40", !i.isActive && "opacity-70")}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold">{i.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {i.code} · {i.categoryName}
                        {!i.isActive ? " · inactive" : ""}
                      </p>
                    </div>
                    <p className="shrink-0 text-right font-semibold tabular-nums">{formatQty(i.qty, i.unit)}</p>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <StatusChips status={i.status} expiring={i.expiringSoon} />
                    {i.depts.map((d) => (
                      <span key={d} className="rounded-full border bg-secondary px-2 py-0.5 text-xs font-medium text-primary">
                        {d}
                      </span>
                    ))}
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Value {formatINRShort(i.valuePaise)} · Reorder at {formatQty(i.reorderLevel, i.unit)}
                    {Number(i.qty) > 0 ? ` · Runs out in ${runsOutText(runsOut[i.id], i.qty)}` : ""}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="mt-3 text-sm text-muted-foreground">
        Showing {rows.length} of {items.length} {items.length === 1 ? "item" : "items"}.
      </p>
    </>
  );
}
