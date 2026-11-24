"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCan } from "@/components/auth/permissions-provider";
import { cn } from "@/lib/utils";

export const PLAN_TABS: { href: string; label: string; show: (can: ReturnType<typeof useCan>) => boolean }[] = [
  { href: "/planning", label: "Timeline", show: () => true },
  // Operators (who only run jobs) see Today and the Timeline.
  { href: "/planning/jobs", label: "Jobs", show: (can) => !operatorOnly(can) },
  { href: "/planning/today", label: "Today", show: () => true },
  { href: "/planning/machines", label: "Machines", show: (can) => !operatorOnly(can) },
  { href: "/planning/insights", label: "Insights", show: (can) => can("insights.planning") },
];

/** Someone who runs jobs but doesn't plan them (the Operator role). */
export const operatorOnly = (can: ReturnType<typeof useCan>) => can("planning.operate") && !can("planning.book") && !can("planning.blocks") && !can("planning.machines");

/** The Planning section's tabs. On phones the strip scrolls inside its own box; the page never scrolls sideways. */
export function PlanningTabs() {
  const pathname = usePathname();
  const can = useCan();
  const active = (href: string) => (href === "/planning" ? pathname === "/planning" : pathname === href || pathname.startsWith(`${href}/`));
  return (
    <nav aria-label="Planning" className="-mx-4 mb-6 overflow-x-auto px-4 md:mx-0 md:px-0">
      <ul className="flex w-max min-w-full gap-1 rounded-xl bg-secondary p-1">
        {PLAN_TABS.filter((t) => t.show(can)).map((t) => (
          <li key={t.href} className="flex-1">
            <Link
              href={t.href}
              aria-current={active(t.href) ? "page" : undefined}
              className={cn(
                "flex h-10 items-center justify-center rounded-lg px-3.5 text-sm font-medium whitespace-nowrap transition",
                active(t.href) ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-primary",
              )}
            >
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
