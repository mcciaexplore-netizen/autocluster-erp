"use client";

import { ChevronDown, Loader2, Repeat2 } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { tryAsAction } from "@/lib/actions/session";

type Role = { role: string; name: string };

function useTryAs() {
  const [pending, start] = useTransition();
  const go = (role: string) =>
    start(async () => {
      const r = await tryAsAction(role); // redirects on success
      if (r?.error) toast.error(r.error);
    });
  return { pending, go };
}

/** Sign-in page, demo site only. */
export function TryAsButtons({ roles }: { roles: Role[] }) {
  const { pending, go } = useTryAs();
  return (
    <section className="mt-6 border-t pt-5" aria-labelledby="try-as">
      <h2 id="try-as" className="text-sm font-semibold">
        Demo: try it as...
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">Signs straight in. Each role sees only what it may.</p>
      <div className="grid grid-cols-2 gap-2">
        {roles.map((r) => (
          <Button key={r.role} type="button" variant="outline" className="h-auto flex-col items-start gap-0 py-2 text-left" disabled={pending} onClick={() => go(r.role)}>
            <span className="font-semibold">{r.role}</span>
            <span className="text-xs font-normal text-muted-foreground">{r.name}</span>
          </Button>
        ))}
      </div>
      {pending ? (
        <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
          <Loader2 className="size-3 animate-spin" aria-hidden /> Signing in...
        </p>
      ) : null}
    </section>
  );
}

/** Top bar on the demo site: "Demo: signed in as Operator (Rohan Deshpande)" with "Switch role". */
export function DemoChip({ label, roles }: { label: string; roles: Role[] }) {
  const { pending, go } = useTryAs();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="flex max-w-[55vw] items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100" aria-label={`Demo: signed in as ${label}. Switch role`}>
          {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Repeat2 className="size-3.5 shrink-0" aria-hidden />}
          <span className="truncate">
            <span className="hidden sm:inline">Demo: signed in as </span>
            {label}
          </span>
          <ChevronDown className="size-3.5 shrink-0" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>Switch role</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {roles.map((r) => (
          <DropdownMenuItem key={r.role} disabled={pending} onSelect={() => go(r.role)}>
            <span className="font-medium">{r.role}</span>
            <span className="ml-auto text-xs text-muted-foreground">{r.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
