"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export const INV_TABS = [
  { href: "/inventory", label: "Overview" },
  { href: "/inventory/items", label: "Items" },
  { href: "/inventory/movements", label: "Stock in & out" },
  { href: "/inventory/counts", label: "Stock count" },
  { href: "/inventory/reorder", label: "Reorder list" },
  { href: "/inventory/suppliers", label: "Suppliers" },
  { href: "/inventory/insights", label: "Insights" },
];

/** The Inventory section's tabs. On phones the strip scrolls inside its own box; the page never scrolls sideways. */
export function InventoryTabs() {
  const pathname = usePathname();
  const active = (href: string) => (href === "/inventory" ? pathname === "/inventory" : pathname === href || pathname.startsWith(`${href}/`));
  return (
    <nav aria-label="Inventory" className="-mx-4 mb-6 overflow-x-auto px-4 md:mx-0 md:px-0">
      <ul className="flex w-max min-w-full gap-1 rounded-xl bg-secondary p-1">
        {INV_TABS.map((t) => (
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
