import Link from "next/link";
import { Suspense } from "react";
import { NavLinkList, NavLinks } from "./nav-links";
import { connection } from "next/server";
import { authEnabled } from "@/lib/auth";
import { UserMenu } from "./user-menu";

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5 rounded-lg" aria-label="AutoCluster, go to Home">
      <span aria-hidden className="grid size-10 place-items-center rounded-xl bg-primary font-title text-lg text-primary-foreground">
        AC
      </span>
      <span className="leading-tight">
        <span className="block text-base font-semibold text-primary">AutoCluster</span>
        <span className="block text-xs text-muted-foreground">Pune</span>
      </span>
    </Link>
  );
}

/** Reads the password setting at request time, so the menu always matches the live configuration. */
async function LiveUserMenu() {
  await connection();
  return <UserMenu showSignOut={authEnabled()} />;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only z-50 rounded-lg bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to main content
      </a>

      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b bg-card/95 px-4 backdrop-blur md:px-6 print:hidden">
        <Logo />
        <Suspense fallback={<UserMenu showSignOut={false} />}>
          <LiveUserMenu />
        </Suspense>
      </header>

      <div className="flex flex-1">
        <nav
          aria-label="Main"
          className="sticky top-16 hidden h-[calc(100dvh-4rem)] w-60 shrink-0 flex-col gap-1 border-r bg-card p-3 md:flex print:hidden"
        >
          <Suspense fallback={<NavLinkList variant="side" pathname={null} />}>
            <NavLinks variant="side" />
          </Suspense>
        </nav>

        <main id="main" className="min-w-0 flex-1 px-4 pt-6 pb-28 md:px-8 md:pt-8 md:pb-12 print:p-0">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t bg-card pb-[env(safe-area-inset-bottom)] md:hidden print:hidden"
      >
        <Suspense fallback={<NavLinkList variant="bottom" pathname={null} />}>
          <NavLinks variant="bottom" />
        </Suspense>
      </nav>
    </div>
  );
}
