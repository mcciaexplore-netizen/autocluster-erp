"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { isActive, NAV } from "./nav";

const STYLES = {
  side: {
    base: "flex h-12 items-center gap-3 rounded-xl px-4 text-base font-medium transition-colors",
    on: "bg-primary text-primary-foreground",
    off: "text-foreground/80 hover:bg-secondary hover:text-primary",
  },
  bottom: {
    base: "flex h-16 min-w-0 flex-col items-center justify-center gap-1 text-[11px] font-medium",
    on: "text-primary",
    off: "text-muted-foreground",
  },
};

export function NavLinks({ variant }: { variant: "side" | "bottom" }) {
  const pathname = usePathname();
  return <NavLinkList variant={variant} pathname={pathname} />;
}

/** Also used (with no active item) as the instant fallback while the page loads. */
export function NavLinkList({ variant, pathname }: { variant: "side" | "bottom"; pathname: string | null }) {
  const s = STYLES[variant];
  return (
    <>
      {NAV.map(({ href, label, short, icon: Icon }) => {
        const active = pathname != null && isActive(pathname, href);
        return (
          <Link key={href} href={href} aria-current={active ? "page" : undefined} className={cn(s.base, active ? s.on : s.off)}>
            {variant === "bottom" ? (
              <span className={cn("grid h-7 w-11 place-items-center rounded-full", active && "bg-secondary")}>
                <Icon className="size-5" aria-hidden />
              </span>
            ) : (
              <Icon className="size-5" aria-hidden />
            )}
            {variant === "bottom" ? (short ?? label) : label}
          </Link>
        );
      })}
    </>
  );
}
