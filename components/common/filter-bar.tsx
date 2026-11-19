"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Keeps list filters in the address bar so they survive a refresh and can be shared. */
export function useUrlFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };
  const clear = () => startTransition(() => router.replace(pathname, { scroll: false }));
  return { params, set, clear, pending };
}

export function SearchBox({ label, placeholder }: { label: string; placeholder?: string }) {
  const { params, set } = useUrlFilters();
  const [q, setQ] = useState(params.get("q") ?? "");
  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get("q") ?? "") !== q.trim()) set("q", q.trim() || null);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  return (
    <div className="relative">
      <label htmlFor="list-search" className="sr-only">
        {label}
      </label>
      <Search className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input
        id="list-search"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder}
        className="h-12 pl-11 text-base"
      />
    </div>
  );
}

export function ChipGroup({
  label,
  name,
  options,
}: {
  label: string;
  name: string;
  options: { value: string; label: string }[];
}) {
  const { params, set } = useUrlFilters();
  const current = params.get(name);
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-2">
      <span className="mr-1 text-sm font-medium text-muted-foreground">{label}:</span>
      {options.map((o) => {
        const active = current === o.value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => set(name, active ? null : o.value)}
            className={cn(
              "h-10 rounded-full border px-4 text-sm font-medium transition",
              active ? "border-primary bg-primary text-primary-foreground" : "bg-card text-foreground hover:border-primary/40",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function ClearFilters({ keys }: { keys: string[] }) {
  const { params, clear } = useUrlFilters();
  if (!keys.some((k) => params.get(k))) return null;
  return (
    <button type="button" onClick={clear} className="inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-primary underline-offset-4 hover:underline">
      <X className="size-4" aria-hidden /> Clear filters
    </button>
  );
}
