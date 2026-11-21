"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { financialYear } from "@/lib/pricing";
import { addDays, todayInIndia } from "@/lib/tickets";
import { cn } from "@/lib/utils";

const ALL = "all";

const monthStart = (today: string, n: number) => new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1 + n, 1)).toISOString().slice(0, 10);

/** Planning looks at this month by default, and ahead as well as back. */
function planningPresets(today: string) {
  const fy = financialYear(new Date(`${today}T00:00:00`));
  return [
    { key: "month", label: "This month", from: monthStart(today, 0), to: addDays(monthStart(today, 1), -1) },
    { key: "last", label: "Last month", from: monthStart(today, -1), to: addDays(monthStart(today, 0), -1) },
    { key: "next2w", label: "Next 2 weeks", from: today, to: addDays(today, 13) },
    { key: "3m", label: "Last 3 months", from: monthStart(today, -2), to: today },
    { key: "fy", label: "This financial year", from: `${fy.slice(0, 4)}-04-01`, to: today },
  ];
}

function presets(today: string) {
  const fy = financialYear(new Date(`${today}T00:00:00`));
  const start = Number(fy.slice(0, 4));
  return [
    { key: "fy", label: "This financial year", from: `${start}-04-01`, to: today },
    { key: "lfy", label: "Last financial year", from: `${start - 1}-04-01`, to: `${start}-03-31` },
    { key: "6m", label: "Last 6 months", from: addDays(today, -182), to: today },
    { key: "30d", label: "Last 30 days", from: addDays(today, -30), to: today },
  ];
}

/** Date range and department, kept in the address so the view can be shared and refreshed. */
export function InsightsFilters({
  from,
  to,
  dept,
  departments,
  periods = "inventory",
}: {
  from: string;
  to: string;
  dept: string | null;
  departments: { code: string; name: string }[];
  periods?: "inventory" | "planning";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();
  const list = periods === "planning" ? planningPresets(todayInIndia()) : presets(todayInIndia());
  const current = list.find((p) => p.from === from && p.to === to)?.key ?? "custom";
  const go = (next: { from?: string; to?: string; dept?: string | null }) => {
    const p = new URLSearchParams({ from: next.from ?? from, to: next.to ?? to });
    const d = next.dept === undefined ? dept : next.dept;
    if (d) p.set("dept", d);
    start(() => router.replace(`${pathname}?${p}`, { scroll: false }));
  };
  return (
    <div className={cn("mb-6 flex flex-wrap items-end gap-3 rounded-2xl border bg-card p-4 transition-opacity", pending && "opacity-60")}>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Period
        <Select
          value={current}
          onValueChange={(k) => {
            const p = list.find((x) => x.key === k);
            if (p) go({ from: p.from, to: p.to });
          }}
        >
          <SelectTrigger className="h-11 w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {list.map((p) => (
              <SelectItem key={p.key} value={p.key}>
                {p.label}
              </SelectItem>
            ))}
            {current === "custom" ? <SelectItem value="custom">Custom dates</SelectItem> : null}
          </SelectContent>
        </Select>
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        From
        <Input type="date" className="h-11 w-40" value={from} max={to} onChange={(e) => e.target.value && go({ from: e.target.value })} />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        To
        <Input type="date" className="h-11 w-40" value={to} min={from} onChange={(e) => e.target.value && go({ to: e.target.value })} />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Department
        <Select value={dept ?? ALL} onValueChange={(v) => go({ dept: v === ALL ? null : v })}>
          <SelectTrigger className="h-11 w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All departments</SelectItem>
            {departments.map((d) => (
              <SelectItem key={d.code} value={d.code}>
                {d.code}: {d.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
    </div>
  );
}
