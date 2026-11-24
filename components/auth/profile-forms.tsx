"use client";

import { Laptop, Loader2, LogOut, Smartphone } from "lucide-react";
import { useActionState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signOutEverywhere, signOutSession, updateProfile, type FormState } from "@/lib/actions/session";

export function DetailsForm({ name, mobile, email }: { name: string; mobile: string; email: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateProfile, { error: null });
  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">Full name</Label>
        <Input id="name" name="name" defaultValue={name} required className="h-11" autoComplete="name" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="mobile">
          Mobile <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input id="mobile" name="mobile" defaultValue={mobile} inputMode="tel" className="h-11" autoComplete="tel" placeholder="e.g. 98220 12345" />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Email</span>
        <p className="text-sm text-muted-foreground">{email} (an admin can change it)</p>
      </div>
      <div aria-live="polite" className="text-sm font-medium">
        {state.error ? <p className="text-destructive">{state.error}</p> : state.ok ? <p className="text-emerald-700">{state.ok}</p> : null}
      </div>
      <Button type="submit" disabled={pending} className="sm:self-start">
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
        Save
      </Button>
    </form>
  );
}

/** "Chrome on Windows" from a browser's user agent, in plain words. */
function deviceName(ua: string | null): { text: string; phone: boolean } {
  if (!ua) return { text: "Unknown device", phone: false };
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Android/.test(ua) ? "Android phone" : /iPhone|iPad/.test(ua) ? "iPhone" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "computer";
  return { text: `${browser} on ${os}`, phone: /Android|iPhone|iPad/.test(ua) };
}

const when = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });

export function SessionList({ sessions }: { sessions: { id: string; current: boolean; ip: string | null; userAgent: string | null; lastUsed: string }[] }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-3">
      <ul className="divide-y rounded-xl border">
        {sessions.map((s) => {
          const d = deviceName(s.userAgent);
          const Icon = d.phone ? Smartphone : Laptop;
          return (
            <li key={s.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 text-sm">
                <span className="block font-medium">
                  {d.text}
                  {s.current ? <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">This device</span> : null}
                </span>
                <span className="block text-xs text-muted-foreground">Last used {when.format(new Date(s.lastUsed))}</span>
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await signOutSession(s.id);
                    if (r.error) toast.error(r.error);
                    else toast.success(r.ok ?? "Signed out.");
                  })
                }
              >
                Sign out of this device
              </Button>
            </li>
          );
        })}
      </ul>
      <form action={signOutEverywhere}>
        <Button type="submit" variant="outline" className="w-full sm:w-auto">
          <LogOut aria-hidden /> Sign out of all devices
        </Button>
      </form>
    </div>
  );
}

const signInWhen = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });

/** "Recent sign-ins": the last 10 sign-ins and failed tries, so someone can spot a stranger. */
export function SignInHistory({ items }: { items: { at: string; ok: boolean; ip: string | null; userAgent: string | null }[] }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">No sign-ins recorded yet.</p>;
  return (
    <>
      <ul className="divide-y text-sm">
        {items.map((s, i) => (
          <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2.5">
            <span className={s.ok ? "" : "font-medium text-destructive"}>{s.ok ? "Signed in" : "Wrong password or refused"}</span>
            <span className="text-muted-foreground tabular-nums">{signInWhen.format(new Date(s.at))}</span>
            <span className="w-full text-xs text-muted-foreground">
              {deviceName(s.userAgent).text}
              {s.ip ? ` · ${s.ip}` : ""}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">Don&apos;t recognise one? Change your password and sign out of all devices.</p>
    </>
  );
}
