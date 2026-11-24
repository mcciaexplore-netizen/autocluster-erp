"use client";

import { Kanban, List, Plus, Search, SlidersHorizontal, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Can } from "@/components/auth/permissions-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CrmPickers } from "@/lib/crm-data";
import { ACTIVITY_FILTERS, CARD_FILTERS, CLOSE_FILTERS, PRIORITY_LABELS, SORTS } from "@/lib/crm/leads";
import { cn } from "@/lib/utils";
import { useCrmFilters } from "./use-crm-filters";

const ALL = "all";

export function CrmToolbar({
  view,
  pickers,
  onNew,
  extra,
}: {
  view: "board" | "list";
  pickers: CrmPickers & { departments: { code: string; name: string }[] };
  onNew: () => void;
  /** Extra buttons on the right (e.g. Edit stages, More). */
  extra?: React.ReactNode;
}) {
  const { params, set, sort, activeCount, clear, query } = useCrmFilters();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get("q") ?? "") !== q.trim()) set({ q: q.trim() || null });
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const pick = (key: string, label: string, options: { value: string; label: string }[], allLabel: string) => (
    <FilterSelect key={key} id={`f-${key}`} label={label} value={params.get(key)} allLabel={allLabel} options={options} onChange={(v) => set({ [key]: v })} />
  );

  return (
    <div className="mb-5 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Can perm="crm.edit">
          <Button onClick={onNew}>
            <Plus aria-hidden /> New enquiry
          </Button>
        </Can>
        <div role="group" aria-label="View" className="ml-auto inline-flex rounded-xl border bg-card p-1">
          <Link
            href={`/crm${query}`}
            aria-current={view === "board" ? "page" : undefined}
            className={cn("inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium", view === "board" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-primary")}
          >
            <Kanban className="size-4" aria-hidden /> Board
          </Link>
          <Link
            href={`/crm/list${query}`}
            aria-current={view === "list" ? "page" : undefined}
            className={cn("inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium", view === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-primary")}
          >
            <List className="size-4" aria-hidden /> List
          </Link>
        </div>
        {extra}
      </div>

      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <label htmlFor="crm-search" className="sr-only">
            Search enquiries
          </label>
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input id="crm-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by title, company, contact, mobile, email or enquiry no." className="h-12 pl-11" />
        </div>
        <Button type="button" variant="outline" className="h-12 lg:hidden" aria-expanded={open} onClick={() => setOpen(!open)}>
          <SlidersHorizontal aria-hidden /> Filters{activeCount ? ` (${activeCount})` : ""}
        </Button>
      </div>

      <div className={cn("grid grid-cols-1 gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-center", !open && "hidden lg:flex")}>
        {pick("assigned", "Assigned to", [{ value: "none", label: "Not assigned" }, ...pickers.team.map((m) => ({ value: m.id, label: m.name }))], "Anyone")}
        {pick("source", "Source", pickers.sources.map((s) => ({ value: s.id, label: s.name })), "Any source")}
        {pick("dept", "Department", pickers.departments.map((d) => ({ value: d.code, label: d.code })), "Any department")}
        {pick("priority", "Priority", [3, 2, 1, 0].map((n) => ({ value: String(n), label: n ? `${"★".repeat(n)} ${PRIORITY_LABELS[n]}` : PRIORITY_LABELS[0] })), "Any priority")}
        {pick("tag", "Tag", pickers.tags.map((t) => ({ value: t.id, label: t.name })), "Any tag")}
        {pick("activity", "Activity", Object.entries(ACTIVITY_FILTERS).map(([value, label]) => ({ value, label })), "Any activity")}
        {pick("close", "Expected close", Object.entries(CLOSE_FILTERS).map(([value, label]) => ({ value, label })), "Any close date")}
        <div className="flex items-center gap-2">
          <label htmlFor="f-sort" className="text-sm font-medium whitespace-nowrap text-muted-foreground">
            Sort by
          </label>
          <Select value={sort} onValueChange={(v) => set({ sort: v === "priority" ? null : v })}>
            <SelectTrigger id="f-sort" size="sm" className="h-10 min-w-0 flex-1 text-sm lg:w-40 lg:flex-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(SORTS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {(Object.keys(CARD_FILTERS) as (keyof typeof CARD_FILTERS)[]).map((k) => {
          const v = params.get(k);
          const label = v ? (CARD_FILTERS[k] as Record<string, string>)[v] : null;
          return label ? (
            <button
              key={k}
              type="button"
              onClick={() => set({ [k]: null })}
              className="inline-flex h-10 items-center gap-1.5 rounded-full border border-primary bg-primary px-4 text-sm font-medium text-primary-foreground"
              aria-label={`Remove filter: ${label}`}
            >
              {label} <X className="size-3.5" aria-hidden />
            </button>
          ) : null;
        })}
        {activeCount || params.get("q") ? (
          <button
            type="button"
            onClick={() => {
              setQ("");
              clear();
            }}
            className="inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-primary hover:underline"
          >
            <X className="size-4" aria-hidden /> Clear filters
          </button>
        ) : null}
      </div>
    </div>
  );
}

function FilterSelect({
  id,
  label,
  value,
  allLabel,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string | null;
  allLabel: string;
  options: { value: string; label: string }[];
  onChange: (v: string | null) => void;
}) {
  const on = !!value && options.some((o) => o.value === value);
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Select value={on ? value! : ALL} onValueChange={(v) => onChange(v === ALL ? null : v)}>
        <SelectTrigger id={id} size="sm" className={cn("h-10 w-full text-sm lg:w-auto lg:min-w-36", on && "border-primary bg-primary/5 font-medium text-primary")} aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{allLabel}</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
