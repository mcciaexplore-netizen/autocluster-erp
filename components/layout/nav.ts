import { FileText, Handshake, Home, Package, Settings, SquareKanban, Tags, Users, type LucideIcon } from "lucide-react";

/** `short` is used in the phone bottom bar where space is tight. */
export const NAV: { href: string; label: string; short?: string; icon: LucideIcon }[] = [
  { href: "/", label: "Home", icon: Home },
  { href: "/crm", label: "CRM", icon: Handshake },
  { href: "/customers", label: "Customers", icon: Users },
  { href: "/quotations", label: "Quotations", short: "Quotes", icon: FileText },
  { href: "/orders", label: "Orders & Billing", short: "Orders", icon: SquareKanban },
  { href: "/inventory", label: "Inventory", short: "Stock", icon: Package },
  { href: "/rate-card", label: "Rate Card", short: "Rates", icon: Tags },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
