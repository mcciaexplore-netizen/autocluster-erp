import { can, type Grants } from "@/lib/auth/can";
import type { Permission } from "@/lib/auth/permissions";
import { CalendarClock, FileText, Handshake, Home, Package, Settings, SquareKanban, Tags, Users, type LucideIcon } from "lucide-react";

/**
 * `short` is used in the phone bottom bar. `bar: true` items sit in the phone bottom bar;
 * the rest are under "More" there. The sidebar shows all of them in this order.
 */
export const NAV: { href: string; label: string; short?: string; icon: LucideIcon; bar?: boolean; perms: Permission[] }[] = [
  { href: "/", label: "Home", icon: Home, bar: true, perms: [] },
  { href: "/crm", label: "CRM", icon: Handshake, bar: true, perms: ["crm.view"] },
  { href: "/customers", label: "Customers", icon: Users, perms: ["customers.view"] },
  { href: "/quotations", label: "Quotations", icon: FileText, perms: ["quotes.view"] },
  { href: "/orders", label: "Orders & Billing", short: "Orders", icon: SquareKanban, bar: true, perms: ["orders.view"] },
  { href: "/planning", label: "Planning", icon: CalendarClock, perms: ["planning.view"] },
  { href: "/inventory", label: "Inventory", short: "Stock", icon: Package, bar: true, perms: ["inventory.view"] },
  { href: "/rate-card", label: "Rate Card", icon: Tags, perms: ["ratecard.view"] },
  { href: "/settings", label: "Settings", icon: Settings, perms: ["settings.edit", "users.manage"] },
];

/** The menu for someone with these grants: only the areas they can view. */
export function navFor(grants: Grants): string[] {
  return NAV.filter((n) => !n.perms.length || n.perms.some((p) => can({ grants }, p))).map((n) => n.href);
}

export function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
