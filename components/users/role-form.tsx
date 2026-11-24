"use client";

import { Copy, Loader2, Lock, Save, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useConfirm } from "@/components/common/confirm";
import { Field } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { copyRoleAction, deleteRoleAction, saveRoleAction } from "@/lib/actions/users";
import { ADMIN_LOCKED, ALL_PERMISSIONS, AREAS, isScoped, PERMISSIONS, type Permission } from "@/lib/auth/permissions";

export type RoleFormValues = { name: string; description: string; scopeOwnDepartments: boolean; permissions: string[] };

export function RoleForm({ id, initial, people }: { id: number | null; initial: RoleFormValues; people?: { id: string; name: string }[] }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [pending, start] = useTransition();
  const [dialog, confirm] = useConfirm();
  const isAdmin = id != null && initial.name === "Admin";
  const locked = (p: Permission) => isAdmin && ADMIN_LOCKED.includes(p);
  const has = (p: string) => v.permissions.includes(p);
  const flip = (p: Permission, on: boolean) => setV((x) => ({ ...x, permissions: on ? [...x.permissions, p] : x.permissions.filter((y) => y !== p) }));
  const anyScoped = ALL_PERMISSIONS.some((p) => isScoped(p) && has(p));

  const save = () =>
    start(async () => {
      const r = await saveRoleAction(id, v);
      if (!r.ok) return void toast.error(r.message);
      toast.success(id ? "Saved. It applies to everyone with this role straight away." : `Role ${v.name.trim()} was created.`);
      if (!id) router.push(`/settings/roles/${r.data.id}`);
      else router.refresh();
    });

  return (
    <div className="flex flex-col gap-6">
      {dialog}
      <section className="rounded-2xl border bg-card p-4 sm:p-6">
        <div className="grid gap-4">
          <Field label="Role name" required helper={isAdmin ? "The Admin role can't be renamed." : undefined}>
            {(p) => <Input {...p} value={v.name} disabled={isAdmin} onChange={(e) => setV((x) => ({ ...x, name: e.target.value }))} className="max-w-md" />}
          </Field>
          <Field label="What this role is for" optional>
            {(p) => <Textarea {...p} rows={2} value={v.description} onChange={(e) => setV((x) => ({ ...x, description: e.target.value }))} />}
          </Field>
        </div>
        <label className="mt-5 flex items-start gap-3 rounded-xl border p-4">
          <Switch checked={v.scopeOwnDepartments} onCheckedChange={(on) => setV((x) => ({ ...x, scopeOwnDepartments: on }))} className="mt-0.5" />
          <span>
            <span className="block font-medium">Can only act on their own departments</span>
            <span className="block text-sm text-muted-foreground">
              Applies to the switches marked &quot;own departments&quot; below. They can still see everything they&apos;re allowed to see.
              {v.scopeOwnDepartments && !anyScoped ? " (No switch below uses this yet.)" : ""}
            </span>
          </span>
        </label>
      </section>

      {AREAS.map((area) => {
        const perms = ALL_PERMISSIONS.filter((p) => PERMISSIONS[p].area === area);
        return (
          <section key={area} className="rounded-2xl border bg-card p-4 sm:p-6">
            <h2 className="mb-3 text-lg font-semibold">{area}</h2>
            <ul className="divide-y">
              {perms.map((p) => (
                <li key={p}>
                  <label className="flex items-center justify-between gap-4 py-3">
                    <span className="min-w-0">
                      <span className="block">{PERMISSIONS[p].label}</span>
                      {isScoped(p) && v.scopeOwnDepartments ? <span className="block text-xs text-muted-foreground">Own departments only</span> : null}
                      {locked(p) ? (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Lock className="size-3" aria-hidden /> Admin always keeps this
                        </span>
                      ) : null}
                    </span>
                    <Switch checked={has(p)} disabled={locked(p)} onCheckedChange={(on) => flip(p, on)} aria-label={PERMISSIONS[p].label} />
                  </label>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <div className="flex flex-wrap gap-3">
        <Button size="lg" onClick={save} disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />} {id ? "Save role" : "Create role"}
        </Button>
        {id ? (
          <Button
            size="lg"
            variant="outline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await copyRoleAction(id);
                if (!r.ok) return void toast.error(r.message);
                toast.success(`Copied as ${r.data.name}.`);
                router.push(`/settings/roles/${r.data.id}`);
              })
            }
          >
            <Copy aria-hidden /> Copy role
          </Button>
        ) : null}
        {id && !isAdmin ? (
          <Button
            size="lg"
            variant="outline"
            className="text-destructive"
            disabled={pending}
            onClick={async () => {
              if (people?.length) {
                await confirm({ title: "This role is in use", description: `${people.length} ${people.length === 1 ? "person has" : "people have"} this role. Give them another role first.`, infoOnly: true });
                return;
              }
              if (!(await confirm({ title: `Delete role ${initial.name}?`, description: "Nobody has this role, so nothing else changes.", confirmLabel: "Delete role", destructive: true }))) return;
              start(async () => {
                const r = await deleteRoleAction(id);
                if (!r.ok) return void toast.error(r.message);
                toast.success(`Deleted role ${r.data.name}.`);
                router.push("/settings/roles");
              });
            }}
          >
            <Trash2 aria-hidden /> Delete role
          </Button>
        ) : null}
      </div>

      {people ? (
        <section className="rounded-2xl border bg-card p-4 sm:p-6">
          <h2 className="mb-3 text-lg font-semibold">People with this role ({people.length})</h2>
          {people.length ? (
            <ul className="flex flex-wrap gap-2">
              {people.map((p) => (
                <li key={p.id}>
                  <Link href={`/settings/users/${p.id}`} className="inline-block rounded-full border bg-secondary px-3 py-1 text-sm font-medium hover:border-primary/40">
                    {p.name}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Nobody yet.</p>
          )}
        </section>
      ) : null}
    </div>
  );
}
