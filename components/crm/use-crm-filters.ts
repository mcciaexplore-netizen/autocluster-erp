"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { filtersFromParams, SORTS, type SortKey } from "@/lib/crm/leads";

export const FILTER_KEYS = ["q", "assigned", "source", "dept", "priority", "tag", "activity", "close", "stage", "created", "state", "won"] as const;

/** Board and list filters live in the page address, so they survive refreshes and can be shared. */
export function useCrmFilters() {
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
  const filters = filtersFromParams(params);
  const sortParam = params.get("sort");
  const sort: SortKey = sortParam && sortParam in SORTS ? (sortParam as SortKey) : "priority";
  const activeCount = FILTER_KEYS.filter((k) => k !== "q" && params.get(k)).length;
  const clear = () => set(Object.fromEntries(FILTER_KEYS.map((k) => [k, null])));
  /** The current filters as ?a=b, to carry over when switching between board and list. */
  const query = (() => {
    const next = new URLSearchParams();
    for (const k of [...FILTER_KEYS, "sort"]) {
      const v = params.get(k);
      if (v) next.set(k, v);
    }
    const s = next.toString();
    return s ? `?${s}` : "";
  })();
  return { params, set, filters, sort, activeCount, clear, query };
}
