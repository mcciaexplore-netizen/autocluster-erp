"use client";

import { ChevronRight, Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { isActive, NAV } from "./nav";

const SIDE = {
  base: "flex h-12 items-center gap-3 rounded-xl px-4 text-base font-medium transition-colors",
  on: "bg-primary text-primary-foreground",
  off: "text-foreground/80 hover:bg-secondary hover:text-primary",
};
// Phone bottom bar: each button is the full bar height (64px) and at least 64px wide, so taps are easy.
const BOTTOM = {
  base: "flex h-16 min-w-0 flex-col items-center justify-center gap-1 text-[11px] font-medium",
  on: "text-primary",
  off: "text-muted-foreground",
};

export function NavLinks({ variant }: { variant: "side" | "bottom" }) {
  const pathname = usePathname();
  return <NavLinkList variant={variant} pathname={pathname} />;
}

/** Also used (with no active item) as the instant fallback while the page loads. */
export function NavLinkList({ variant, pathname }: { variant: "side" | "bottom"; pathname: string | null }) {
  if (variant === "side") {
    return (
      <>
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname != null && isActive(pathname, href);
          return (
            <Link key={href} href={href} aria-current={active ? "page" : undefined} className={cn(SIDE.base, active ? SIDE.on : SIDE.off)}>
              <Icon className="size-5" aria-hidden />
              {label}
            </Link>
          );
        })}
      </>
    );
  }
  const more = NAV.filter((n) => !n.bar);
  const inMore = pathname != null && more.some((n) => isActive(pathname, n.href));
  return (
    <>
      {NAV.filter((n) => n.bar).map(({ href, label, short, icon: Icon }) => {
        const active = pathname != null && isActive(pathname, href);
        return (
          <Link key={href} href={href} aria-current={active ? "page" : undefined} className={cn(BOTTOM.base, active ? BOTTOM.on : BOTTOM.off)}>
            <span className={cn("grid h-7 w-12 place-items-center rounded-full", active && "bg-secondary")}>
              <Icon className="size-5" aria-hidden />
            </span>
            <span>{short ?? label}</span>
          </Link>
        );
      })}
      <MoreMenu pathname={pathname} active={inMore} items={more} />
    </>
  );
}

/** "More" in the phone bottom bar: a sheet with the pages that don't fit in the bar. */
function MoreMenu({ pathname, active, items }: { pathname: string | null; active: boolean; items: typeof NAV }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" aria-haspopup="dialog" aria-expanded={open} aria-current={active ? "page" : undefined} onClick={() => setOpen(true)} className={cn(BOTTOM.base, active ? BOTTOM.on : BOTTOM.off)}>
        <span className={cn("grid h-7 w-12 place-items-center rounded-full", active && "bg-secondary")}>
          <Menu className="size-5" aria-hidden />
        </span>
        <span>More</span>
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="gap-0 rounded-t-2xl p-0 pb-[env(safe-area-inset-bottom)]">
          <SheetHeader className="border-b px-5 py-4">
            <SheetTitle>More</SheetTitle>
            <SheetDescription className="sr-only">Other pages</SheetDescription>
          </SheetHeader>
          <ul className="p-2">
            {items.map(({ href, label, icon: Icon }) => {
              const on = pathname != null && isActive(pathname, href);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    onClick={() => setOpen(false)}
                    aria-current={on ? "page" : undefined}
                    className={cn("flex h-14 items-center gap-4 rounded-xl px-4 text-base font-medium", on ? "bg-secondary text-primary" : "text-foreground hover:bg-secondary")}
                  >
                    <Icon className="size-5 text-primary" aria-hidden />
                    <span className="flex-1">{label}</span>
                    <ChevronRight className="size-5 text-muted-foreground" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        </SheetContent>
      </Sheet>
    </>
  );
}
