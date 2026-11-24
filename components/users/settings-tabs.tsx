"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCan } from "@/components/auth/permissions-provider";
import type { Permission } from "@/lib/auth/permissions";
import { cn } from "@/lib/utils";

const TABS: { href: string; label: string; perm: Permission }[] = [
  { href: "/settings", label: "General", perm: "settings.edit" },
  { href: "/settings/users", label: "Users", perm: "users.manage" },
  { href: "/settings/roles", label: "Roles", perm: "users.manage" },
];

/** Settings' tabs, only the ones the person can open. On phones the strip scrolls inside its own box. */
export function SettingsTabs() {
  const pathname = usePathname();
  const can = useCan();
  const tabs = TABS.filter((t) => can(t.perm));
  if (tabs.length < 2) return null;
  const active = (href: string) => (href === "/settings" ? pathname === "/settings" : pathname === href || pathname.startsWith(`${href}/`));
  return (
    <nav aria-label="Settings" className="-mx-4 mb-6 overflow-x-auto px-4 md:mx-0 md:px-0">
      <ul className="flex w-max min-w-full gap-1 rounded-xl bg-secondary p-1">
        {tabs.map((t) => (
          <li key={t.href} className="flex-1">
            <Link
              href={t.href}
              aria-current={active(t.href) ? "page" : undefined}
              className={cn("flex h-10 items-center justify-center rounded-lg px-3.5 text-sm font-medium whitespace-nowrap transition", active(t.href) ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-primary")}
            >
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
