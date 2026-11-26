"use client";

import { Check, Copy, KeyRound, Loader2, LogOut, Power, Save, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useConfirm } from "@/components/common/confirm";
import { Field } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { deactivateUserAction, reactivateUserAction, resetPasswordAction, saveUserAction, signOutUserAction } from "@/lib/actions/users";
import { cn } from "@/lib/utils";

type RoleOption = { id: number; name: string; description: string };
type Dept = { code: string; name: string };
export type UserFormValues = { name: string; canSignIn: boolean; email: string; mobile: string; roleIds: number[]; allDepartments: boolean; deptCodes: string[]; maxMachines: string };

/** Shown once after saving or resetting: the temporary password, with Copy. It is never shown again. */
export function TempPasswordDialog({ name, password, onClose }: { name: string; password: string | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Dialog open={!!password} onOpenChange={(o) => !o && onClose()}>
      <DialogContent onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-5 text-primary" aria-hidden /> Temporary password for {name}
          </DialogTitle>
          <DialogDescription>Share this privately. They&apos;ll be asked to change it when they first sign in. It won&apos;t be shown again.</DialogDescription>
        </DialogHeader>
        <p className="rounded-xl border bg-secondary px-4 py-3 text-center font-mono text-lg font-semibold tracking-wide break-all select-all">{password}</p>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(password ?? "");
                setCopied(true);
              } catch {
                toast.error("Couldn't copy. Please select the password and copy it.");
              }
            }}
          >
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />} {copied ? "Copied" : "Copy"}
          </Button>
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function UserForm({
  id,
  initial,
  roles,
  departments,
  status,
}: {
  id: string | null;
  initial: UserFormValues;
  roles: RoleOption[];
  departments: Dept[];
  /** Existing people: whether they are deactivated, and whether they already have an account. */
  status?: { deactivated: boolean; hasAccount: boolean; isSelf: boolean };
}) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [pending, start] = useTransition();
  const [temp, setTemp] = useState<{ password: string; then: string | null } | null>(null);
  const [dialog, confirm] = useConfirm();
  const set = <K extends keyof UserFormValues>(k: K, val: UserFormValues[K]) => setV((x) => ({ ...x, [k]: val }));
  const toggle = <T,>(list: T[], x: T) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);

  const save = () =>
    start(async () => {
      const r = await saveUserAction(id, { ...v, email: v.email.trim() || null, mobile: v.mobile.trim() || null, maxMachines: v.maxMachines.trim() ? Number(v.maxMachines) : null });
      if (!r.ok) return void toast.error(r.message);
      toast.success(id ? "Saved." : `${v.name.trim()} was added.`);
      if (r.data.tempPassword) setTemp({ password: r.data.tempPassword, then: id ? null : `/settings/users/${r.data.id}` });
      else if (!id) router.push(`/settings/users/${r.data.id}`);
      else router.refresh();
    });

  const act = (fn: () => Promise<{ ok: boolean; message?: string; data?: unknown }>, ok: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.message);
      toast.success(ok);
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-6">
      {dialog}
      <TempPasswordDialog
        name={v.name}
        password={temp?.password ?? null}
        onClose={() => {
          const then = temp?.then;
          setTemp(null);
          if (then) router.push(then);
          else router.refresh();
        }}
      />

      <section className="rounded-2xl border bg-card p-4 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" required>
            {(p) => <Input {...p} value={v.name} onChange={(e) => set("name", e.target.value)} autoComplete="off" />}
          </Field>
          <Field label="Mobile" optional helper="10-digit Indian mobile, e.g. 98220 12345">
            {(p) => <Input {...p} value={v.mobile} onChange={(e) => set("mobile", e.target.value)} inputMode="tel" />}
          </Field>
        </div>
        <label className="mt-5 flex items-start gap-3 rounded-xl border p-4">
          <Switch checked={v.canSignIn} onCheckedChange={(on) => set("canSignIn", on)} className="mt-0.5" />
          <span>
            <span className="block font-medium">Can sign in</span>
            <span className="block text-sm text-muted-foreground">
              Off = name only: they can still be assigned work (e.g. a contract operator) but can&apos;t use the app themselves.
            </span>
          </span>
        </label>
        {v.canSignIn ? (
          <div className="mt-4 max-w-md">
            <Field label="Email" required helper="They sign in with this.">
              {(p) => <Input {...p} type="email" value={v.email} onChange={(e) => set("email", e.target.value)} autoComplete="off" />}
            </Field>
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border bg-card p-4 sm:p-6">
        <h2 className="mb-1 text-lg font-semibold">Roles</h2>
        <p className="mb-4 text-sm text-muted-foreground">Choose one or more. What they can do adds up.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {roles.map((r) => {
            const on = v.roleIds.includes(r.id);
            return (
              <label key={r.id} className={cn("flex cursor-pointer gap-3 rounded-xl border-2 p-4 transition has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring", on ? "border-primary bg-secondary" : "hover:border-primary/40")}>
                <input type="checkbox" className="sr-only" checked={on} onChange={() => set("roleIds", toggle(v.roleIds, r.id))} />
                <span className={cn("mt-0.5 grid size-6 shrink-0 place-items-center rounded-md border-2", on ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card")} aria-hidden>
                  {on ? <Check className="size-4" /> : null}
                </span>
                <span className="min-w-0">
                  <span className="block font-semibold text-primary">{r.name}</span>
                  <span className="block text-sm text-muted-foreground">{r.description}</span>
                </span>
              </label>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-4 sm:p-6">
        <h2 className="mb-1 text-lg font-semibold">Departments</h2>
        <p className="mb-4 text-sm text-muted-foreground">Roles marked &quot;own departments&quot; (e.g. Planner, Operator) only act on these.</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Departments">
          <button
            type="button"
            aria-pressed={v.allDepartments}
            onClick={() => set("allDepartments", !v.allDepartments)}
            className={cn("h-10 rounded-full border px-4 text-sm font-medium transition", v.allDepartments ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-primary/40")}
          >
            All departments
          </button>
          {departments.map((d) => {
            const on = !v.allDepartments && v.deptCodes.includes(d.code);
            return (
              <button
                key={d.code}
                type="button"
                aria-pressed={on}
                onClick={() => setV((x) => ({ ...x, allDepartments: false, deptCodes: toggle(x.allDepartments ? [] : x.deptCodes, d.code) }))}
                className={cn("h-10 rounded-full border px-4 text-sm font-medium transition", on ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-primary/40")}
                title={d.name}
              >
                {d.code}
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-4 sm:p-6">
        <h2 className="mb-1 text-lg font-semibold">Machines at once</h2>
        <p className="mb-4 text-sm text-muted-foreground">How many machines this person can run at the same time. Leave empty to use the number in Settings &gt; Planning. Day-and-night machines don&apos;t count.</p>
        <Field label="Machines this person can run at once" optional helper="e.g. 2. Empty = the Settings number." className="max-w-xs">
          {(p) => <Input {...p} type="number" min={1} max={20} step={1} inputMode="numeric" value={v.maxMachines} onChange={(e) => set("maxMachines", e.target.value)} />}
        </Field>
      </section>

      <div className="flex flex-wrap gap-3">
        <Button size="lg" onClick={save} disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />} {id ? "Save changes" : "Add user"}
        </Button>
      </div>

      {id && status ? (
        <section className="rounded-2xl border bg-card p-4 sm:p-6">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
            <ShieldCheck className="size-5 text-primary" aria-hidden /> Sign-in
          </h2>
          <div className="flex flex-wrap gap-3">
            {status.hasAccount && initial.canSignIn ? (
              <Button
                variant="outline"
                disabled={pending}
                onClick={async () => {
                  if (!(await confirm({ title: `Reset ${initial.name}'s password?`, description: "They'll get a new temporary password and be signed out of all devices.", confirmLabel: "Reset password" }))) return;
                  start(async () => {
                    const r = await resetPasswordAction(id);
                    if (!r.ok) return void toast.error(r.message);
                    setTemp({ password: r.data.tempPassword, then: null });
                  });
                }}
              >
                <KeyRound aria-hidden /> Reset password
              </Button>
            ) : null}
            {status.hasAccount ? (
              <Button variant="outline" disabled={pending} onClick={() => act(() => signOutUserAction(id), "Signed out of all devices.")}>
                <LogOut aria-hidden /> Sign out of all devices
              </Button>
            ) : null}
            {status.deactivated ? (
              <Button variant="outline" disabled={pending} onClick={() => act(() => reactivateUserAction(id), "Reactivated.")}>
                <Power aria-hidden /> Reactivate
              </Button>
            ) : (
              <Button
                variant="outline"
                className="text-destructive"
                disabled={pending || status.isSelf}
                title={status.isSelf ? "You can't deactivate yourself" : undefined}
                onClick={async () => {
                  if (!(await confirm({ title: `Deactivate ${initial.name}?`, description: "They won't be able to sign in, and they'll be signed out everywhere now. Their history stays.", confirmLabel: "Deactivate", destructive: true }))) return;
                  act(() => deactivateUserAction(id), "Deactivated.");
                }}
              >
                <Power aria-hidden /> Deactivate
              </Button>
            )}
          </div>
          <p className="mt-3 text-sm text-muted-foreground">People who appear in any history can&apos;t be deleted. Deactivate them instead.</p>
        </section>
      ) : null}
    </div>
  );
}
