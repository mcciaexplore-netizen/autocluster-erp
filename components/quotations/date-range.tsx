"use client";

import { useUrlFilters } from "@/components/common/filter-bar";
import { Input } from "@/components/ui/input";

export function DateRangeFilter() {
  const { params, set } = useUrlFilters();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-medium text-muted-foreground">Date:</span>
      <label className="sr-only" htmlFor="from">From date</label>
      <Input id="from" type="date" className="h-10 w-40" value={params.get("from") ?? ""} onChange={(e) => set("from", e.target.value || null)} />
      <span className="text-sm text-muted-foreground">to</span>
      <label className="sr-only" htmlFor="to">To date</label>
      <Input id="to" type="date" className="h-10 w-40" value={params.get("to") ?? ""} onChange={(e) => set("to", e.target.value || null)} />
    </div>
  );
}
