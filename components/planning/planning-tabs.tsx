"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export const PLAN_TABS = [
  { href: "/planning", label: "Timeline" },
  { href: "/planning/jobs", label: "Jobs" },
  { href: "/planning/today", label: "Today" },
  { href: "/planning/machines", label: "Machines" },
  { href: "/planning/insights", label: "Insights" },
];

/** The Planning section's tabs. On phones the strip scrolls inside its own box; the page never scrolls sideways. */
export function PlanningTabs() {
  const pathname = usePathname();
  const active = (href: string) => (href === "/planning" ? pathname === "/planning" : pathname === href || pathname.startsWith(`${href}/`));
  return (
    <nav aria-label="Planning" className="-mx-4 mb-6 overflow-x-auto px-4 md:mx-0 md:px-0">
      <ul className="flex w-max min-w-full gap-1 rounded-xl bg-secondary p-1">
        {PLAN_TABS.map((t) => (
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
