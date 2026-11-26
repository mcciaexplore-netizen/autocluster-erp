"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import type { DeptChoice } from "@/lib/planning/dept-scope";
import { PLANNING_DEPT_COOKIE } from "@/lib/planning/dept-scope";
import { cn } from "@/lib/utils";

/** Remembers the department on this device (the server reads it when a page opens without one). */
function remember(value: string) {
  document.cookie = `${PLANNING_DEPT_COOKIE}=${encodeURIComponent(value)}; path=/; max-age=${400 * 86_400}; samesite=lax`;
}

/**
 * Department chips for Planning: none with a single department, only theirs with a few, and every
 * department plus "All" for people with every department. The server only ever sends their own.
 */
export function DeptChips({ choice, className }: { choice: DeptChoice; className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  if (!choice.picker && !choice.allowAll) return null;
  const go = (value: string) => {
    remember(value);
    const next = new URLSearchParams(params.toString());
    next.set("dept", value);
    next.delete("machine");
    start(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }));
  };
  const chips = [...(choice.allowAll ? [{ code: "all", label: "All" }] : []), ...choice.options.map((d) => ({ code: d.code, label: d.code, title: d.name }))];
  const current = choice.chosen ?? "all";
  return (
    <div role="group" aria-label="Department" aria-busy={pending} className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {chips.map((c) => (
        <button
          key={c.code}
          type="button"
          aria-pressed={current === c.code}
          title={"title" in c ? c.title : "All departments"}
          onClick={() => go(c.code)}
          className={cn("h-9 rounded-full border px-3.5 text-sm font-medium transition", current === c.code ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-primary/40")}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}
