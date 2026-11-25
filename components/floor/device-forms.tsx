"use client";

import { Loader2, MonitorSmartphone, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import { toast } from "sonner";
import { useConfirm } from "@/components/common/confirm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setOwnPin, type FormState } from "@/lib/actions/session";
import { clearUserPinAction, markThisDeviceSharedAction, revokeDeviceAction, setUserPinAction, stopSharingThisDeviceAction } from "@/lib/actions/users";
import { cn } from "@/lib/utils";

/** Profile: "Shop-floor PIN". */
export function OwnPinForm({ hasPin }: { hasPin: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(setOwnPin, { error: null });
  return (
    <form action={action} className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{hasPin ? "You have a PIN. Type a new one to change it." : "Set a 4 to 6 digit PIN to start and finish your jobs on the shop-floor tablet."}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pin">New PIN</Label>
          <Input id="pin" name="pin" type="password" inputMode="numeric" pattern="\d{4,6}" maxLength={6} autoComplete="off" className="h-11 font-mono tracking-widest" required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pin-again">Type it again</Label>
          <Input id="pin-again" name="again" type="password" inputMode="numeric" pattern="\d{4,6}" maxLength={6} autoComplete="off" className="h-11 font-mono tracking-widest" required />
        </div>
      </div>
      <div aria-live="polite" className="text-sm font-medium">
        {state.error ? <p className="text-destructive">{state.error}</p> : state.ok ? <p className="text-emerald-700">{state.ok}</p> : null}
      </div>
      <Button type="submit" disabled={pending} className="sm:self-start">
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : null} Save PIN
      </Button>
    </form>
  );
}

/** Profile (Admins): mark this browser as a shared shop-floor device, or stop sharing it. */
export function ThisDeviceForm({ current, departments }: { current: { name: string; deptCodes: string[] } | null; departments: { code: string; name: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [depts, setDepts] = useState<string[]>([]);
  const [dialog, confirm] = useConfirm();
  if (current) {
    return (
      <div className="flex flex-col gap-3">
        {dialog}
        <p className="flex items-center gap-2 font-medium">
          <MonitorSmartphone className="size-5 text-primary" aria-hidden /> This device is shared: {current.name}
        </p>
        <p className="text-sm text-muted-foreground">{current.deptCodes.length ? `Departments: ${current.deptCodes.join(", ")}.` : "All departments."} When nobody is signed in, it shows the operators&apos; names on the shop-floor screen.</p>
        <Button
          variant="outline"
          className="sm:self-start"
          disabled={pending}
          onClick={async () => {
            if (!(await confirm({ title: "Stop sharing this device?", description: "Operators won't be able to use their PINs here any more.", confirmLabel: "Stop sharing" }))) return;
            start(async () => {
              const r = await stopSharingThisDeviceAction();
              if (!r.ok) return void toast.error(r.message);
              toast.success("This device is no longer shared.");
              router.refresh();
            });
          }}
        >
          Stop sharing this device
        </Button>
      </div>
    );
  }
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await markThisDeviceSharedAction({ name, deptCodes: depts });
          if (!r.ok) return void toast.error(r.message);
          toast.success("This device is now a shared shop-floor device. Sign out, and it shows the operators' names.");
          router.refresh();
        });
      }}
    >
      <p className="text-sm text-muted-foreground">For a tablet or PC on the shop floor that several operators use. They sign in with their name and PIN, only for Today&apos;s work.</p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="device-name">Name of this device</Label>
        <Input id="device-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. RPT shop floor tablet" maxLength={60} className="h-11" />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Departments</span>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Departments">
          {departments.map((d) => {
            const on = depts.includes(d.code);
            return (
              <button key={d.code} type="button" aria-pressed={on} title={d.name} onClick={() => setDepts((x) => (on ? x.filter((y) => y !== d.code) : [...x, d.code]))} className={cn("h-10 rounded-full border px-4 text-sm font-medium transition", on ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-primary/40")}>
                {d.code}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">None chosen = all departments.</p>
      </div>
      <Button type="submit" disabled={pending} className="sm:self-start">
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <MonitorSmartphone aria-hidden />} Mark as shared shop-floor device
      </Button>
    </form>
  );
}

/** User page (Admins): set or remove someone's PIN. */
export function UserPinForm({ id, name, hasPin }: { id: string; name: string; hasPin: boolean }) {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{hasPin ? `${name} has a PIN.` : `${name} has no PIN yet.`} It works only on shared shop-floor devices.</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="user-pin">{hasPin ? "New PIN" : "PIN"}</Label>
          <Input id="user-pin" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))} type="password" inputMode="numeric" autoComplete="off" placeholder="4 to 6 digits" className="h-10 w-40 font-mono tracking-widest" />
        </div>
        <Button
          disabled={pending || pin.length < 4}
          onClick={() =>
            start(async () => {
              const r = await setUserPinAction(id, pin);
              if (!r.ok) return void toast.error(r.message);
              setPin("");
              toast.success(`PIN saved for ${name}. Tell them privately.`);
              router.refresh();
            })
          }
        >
          <Save aria-hidden /> Save PIN
        </Button>
        {hasPin ? (
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await clearUserPinAction(id);
                if (!r.ok) return void toast.error(r.message);
                toast.success("PIN removed.");
                router.refresh();
              })
            }
          >
            Remove PIN
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** Users page: the shared devices, with "Stop" for a lost or replaced one. */
export function SharedDevicesList({ devices }: { devices: { id: string; name: string; deptCodes: string[]; createdAt: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [dialog, confirm] = useConfirm();
  return (
    <section className="mt-8 rounded-2xl border bg-card p-4 sm:p-6">
      {dialog}
      <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold">
        <MonitorSmartphone className="size-5 text-primary" aria-hidden /> Shared shop-floor devices
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">To add one, open your Profile on that device and choose &quot;Mark as shared shop-floor device&quot;.</p>
      {devices.length ? (
        <ul className="divide-y">
          {devices.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <span>
                <span className="block font-medium">{d.name}</span>
                <span className="block text-sm text-muted-foreground">{d.deptCodes.length ? d.deptCodes.join(", ") : "All departments"}</span>
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={async () => {
                  if (!(await confirm({ title: `Stop ${d.name}?`, description: "Anyone using it is signed out, and PINs stop working on it.", confirmLabel: "Stop device", destructive: true }))) return;
                  start(async () => {
                    const r = await revokeDeviceAction(d.id);
                    if (!r.ok) return void toast.error(r.message);
                    toast.success(`Stopped ${r.data.name}.`);
                    router.refresh();
                  });
                }}
              >
                Stop
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No shared devices yet.</p>
      )}
    </section>
  );
}
