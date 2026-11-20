import { FileText, Handshake, Home, Package, Settings, SquareKanban, Tags, Users, type LucideIcon } from "lucide-react";

/**
 * `short` is used in the phone bottom bar. `bar: true` items sit in the phone bottom bar;
 * the rest are under "More" there. The sidebar shows all of them in this order.
 */
export const NAV: { href: string; label: string; short?: string; icon: LucideIcon; bar?: boolean }[] = [
  { href: "/", label: "Home", icon: Home, bar: true },
  { href: "/crm", label: "CRM", icon: Handshake, bar: true },
  { href: "/customers", label: "Customers", icon: Users },
  { href: "/quotations", label: "Quotations", icon: FileText },
  { href: "/orders", label: "Orders & Billing", short: "Orders", icon: SquareKanban, bar: true },
  { href: "/inventory", label: "Inventory", short: "Stock", icon: Package, bar: true },
  { href: "/rate-card", label: "Rate Card", icon: Tags },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
