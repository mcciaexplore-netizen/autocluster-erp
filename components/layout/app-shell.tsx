import Link from "next/link";
import { Suspense } from "react";
import { NavLinkList, NavLinks } from "./nav-links";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { navFor } from "./nav";
import { UserMenu } from "./user-menu";
import { FloorBar } from "@/components/floor/floor-context";
import { DemoChip } from "@/components/demo/try-as";
import { TRY_AS_ROLES } from "@/db/demo-users";
import { isDemoMode } from "@/lib/auth/demo-mode";

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

/**
 * The signed-in person's menu. Also the safety net for every page: a session that has ended
 * (signed out elsewhere, deactivated) goes to sign-in, and a temporary password must be changed first.
 */
async function LiveUserMenu() {
  const me = await getCurrentUser();
  if (!me) redirect("/sign-in");
  if (me.mustChangePassword) redirect("/change-password");
  // A PIN session on a shared shop-floor device: no account menu, just "Done".
  if (me.floor) return <FloorBar name={me.name} />;
  const menu = <UserMenu name={me.name} roles={me.roles.map((r) => r.name)} />;
  if (!isDemoMode()) return menu;
  // Demo site: which role this is, and "Switch role".
  const role = TRY_AS_ROLES.find((r) => r.name === me.name)?.role ?? (me.roles.map((r) => r.name).join(" + ") || "No role");
  return (
    <div className="flex items-center gap-2">
      <DemoChip label={`${role} (${me.name})`} roles={TRY_AS_ROLES} />
      {menu}
    </div>
  );
}

/** Only the areas the signed-in person can view. */
async function LiveNav({ variant }: { variant: "side" | "bottom" }) {
  const me = await getCurrentUser();
  return <NavLinks variant={variant} allowed={me ? navFor(me.grants) : ["/"]} />;
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
        <Suspense fallback={<UserMenu name={null} roles={[]} />}>
          <LiveUserMenu />
        </Suspense>
      </header>

      <div className="flex flex-1">
        <nav
          aria-label="Main"
          className="sticky top-16 hidden h-[calc(100dvh-4rem)] w-60 shrink-0 flex-col gap-1 border-r bg-card p-3 md:flex print:hidden"
        >
          <Suspense fallback={<NavLinkList variant="side" pathname={null} allowed={["/"]} />}>
            <LiveNav variant="side" />
          </Suspense>
        </nav>

        <main id="main" className="min-w-0 flex-1 px-4 pt-6 pb-28 md:px-8 md:pt-8 md:pb-12 print:p-0">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 grid auto-cols-fr grid-flow-col border-t bg-card pb-[env(safe-area-inset-bottom)] md:hidden print:hidden"
      >
        <Suspense fallback={<NavLinkList variant="bottom" pathname={null} allowed={["/"]} />}>
          <LiveNav variant="bottom" />
        </Suspense>
      </nav>
    </div>
  );
}
