"use client";

import { ChevronDown, ChevronRight, Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { COMING_SOON } from "@/lib/coming-soon";
import { isActive, NAV } from "./nav";

/** The small grey "Soon" badge on coming-soon modules. */
function SoonBadge() {
  return <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Soon</span>;
}
const soonHref = (slug: string) => `/soon/${slug}`;

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

export function NavLinks({ variant, allowed }: { variant: "side" | "bottom"; allowed: string[] }) {
  const pathname = usePathname();
  return <NavLinkList variant={variant} pathname={pathname} allowed={allowed} />;
}

/** Also used (with no active item) as the instant fallback while the page loads. */
export function NavLinkList({ variant, pathname, allowed }: { variant: "side" | "bottom"; pathname: string | null; allowed: string[] }) {
  const items = NAV.filter((n) => allowed.includes(n.href));
  if (variant === "side") {
    return (
      <>
        {items.map(({ href, label, icon: Icon }) => {
          const active = pathname != null && isActive(pathname, href);
          return (
            <Link key={href} href={href} aria-current={active ? "page" : undefined} className={cn(SIDE.base, active ? SIDE.on : SIDE.off)}>
              <Icon className="size-5" aria-hidden />
              {label}
            </Link>
          );
        })}
        <ComingSoonGroup pathname={pathname} />
      </>
    );
  }
  // Phone bar: up to 5 buttons. With more areas (or the coming-soon list), the preferred four plus "More".
  const fits = items.length <= (COMING_SOON.length ? 4 : 5);
  const bar = fits ? items : [...items.filter((n) => n.bar), ...items.filter((n) => !n.bar)].slice(0, 4);
  const more = fits ? [] : items.filter((n) => !bar.includes(n));
  const inMore = pathname != null && more.some((n) => isActive(pathname, n.href));
  return (
    <>
      {bar.map(({ href, label, short, icon: Icon }) => {
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
      {more.length || COMING_SOON.length ? <MoreMenu pathname={pathname} active={inMore || (pathname?.startsWith("/soon/") ?? false)} items={more} /> : null}
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
          {COMING_SOON.length ? (
            <>
              <h2 className="border-t px-5 pt-4 pb-1 text-sm font-semibold text-muted-foreground">Coming soon</h2>
              <ul className="max-h-[45dvh] overflow-y-auto p-2">
                {COMING_SOON.map(({ slug, name, icon: Icon }) => {
                  const on = pathname != null && isActive(pathname, soonHref(slug));
                  return (
                    <li key={slug}>
                      <Link
                        href={soonHref(slug)}
                        onClick={() => setOpen(false)}
                        aria-current={on ? "page" : undefined}
                        className={cn("flex h-12 items-center gap-4 rounded-xl px-4 text-base", on ? "bg-secondary text-primary" : "text-foreground/80 hover:bg-secondary")}
                      >
                        <Icon className="size-5 text-muted-foreground" aria-hidden />
                        <span className="flex-1">{name}</span>
                        <SoonBadge />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}

/** Sidebar: "Coming soon (10)", open by default, below the working areas. Every signed-in role sees it. */
function ComingSoonGroup({ pathname }: { pathname: string | null }) {
  const [open, setOpen] = useState(true);
  if (!COMING_SOON.length) return null;
  return (
    <div className="mt-3 border-t pt-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="coming-soon-list"
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 w-full items-center gap-2 rounded-xl px-4 text-sm font-semibold text-muted-foreground hover:bg-secondary hover:text-primary"
      >
        <span className="flex-1 text-left">Coming soon ({COMING_SOON.length})</span>
        <ChevronDown className={cn("size-4 transition-transform", !open && "-rotate-90")} aria-hidden />
      </button>
      {open ? (
        <ul id="coming-soon-list" className="mt-1 flex flex-col gap-0.5">
          {COMING_SOON.map(({ slug, name, icon: Icon }) => {
            const active = pathname != null && isActive(pathname, soonHref(slug));
            return (
              <li key={slug}>
                <Link
                  href={soonHref(slug)}
                  aria-current={active ? "page" : undefined}
                  className={cn("flex min-h-10 items-center gap-3 rounded-xl px-4 py-2 text-sm leading-tight transition-colors", active ? "bg-secondary text-primary" : "text-foreground/70 hover:bg-secondary hover:text-primary")}
                >
                  <Icon className="size-4 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1">{name}</span>
                  <SoonBadge />
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
