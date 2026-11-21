"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Cog, Loader2, Save, Search, Tags, Timer } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { Field, FormSection } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useUnsavedChangesWarning } from "@/hooks/use-unsaved-changes";
import { saveMachineAction } from "@/lib/actions/planning";
import type { MachineFormOptions } from "@/lib/planning-data";
import { MACHINE_STATUS, machineFormSchema, type MachineFormValues, type MachineStatusName } from "@/lib/validation/planning";

/** Add or edit a machine. */
export function MachineForm({ machineId, initial, options }: { machineId: string | null; initial: MachineFormValues; options: MachineFormOptions }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [q, setQ] = useState("");
  const form = useForm<MachineFormValues>({ resolver: zodResolver(machineFormSchema), defaultValues: initial, mode: "onTouched" });
  const { register, control, handleSubmit, formState } = form;
  const e = formState.errors;
  useUnsavedChangesWarning(formState.isDirty);
  const picked = useWatch({ control, name: "serviceIds" }) ?? [];
  const num = { valueAsNumber: true } as const;

  const onSubmit = (ev: React.FormEvent<HTMLFormElement>) =>
    handleSubmit(
      (v) =>
        start(async () => {
          const r = await saveMachineAction(machineId, v);
          if (!r.ok) return void toast.error(r.message);
          form.reset(v);
          toast.success(machineId ? "Machine saved" : `Machine ${"code" in r.data ? r.data.code : ""} added`);
          router.push(`/planning/machines/${r.data.id}`);
          router.refresh();
        }),
      () => toast.error("Some details need a second look. Please check the fields marked in red."),
    )(ev);

  const needle = q.trim().toLowerCase();
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <FormSection title="Machine" icon={<Cog className="size-5" />}>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <Field label="Machine name" required error={e.name?.message} helper="e.g. SLA - 3D Systems 7000 HD" className="md:col-span-2">
            {(p) => <Input {...p} {...register("name")} maxLength={120} />}
          </Field>
          <Field label="Machine code" error={e.code?.message} helper={machineId ? "Must be unique." : `Given automatically (next: ${options.nextCode}). You can type your own.`}>
            {(p) => <Input {...p} className="uppercase" placeholder={machineId ? undefined : options.nextCode} {...register("code")} maxLength={20} />}
          </Field>
          <Field label="Department" required error={e.deptCode?.message}>
            {(p) => (
              <Controller
                control={control}
                name="deptCode"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger {...p} className="w-full">
                      <SelectValue placeholder="Choose the department" />
                    </SelectTrigger>
                    <SelectContent>
                      {options.departments.map((d) => (
                        <SelectItem key={d.code} value={d.code}>
                          {d.code} - {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            )}
          </Field>
          <Field label="Make and model" optional error={e.makeModel?.message} helper="e.g. Tinius Olsen MP 600">
            {(p) => <Input {...p} {...register("makeModel")} maxLength={120} />}
          </Field>
          <Field label="Where it is" optional error={e.location?.message} helper="e.g. RPT lab, bay 2">
            {(p) => <Input {...p} {...register("location")} maxLength={120} />}
          </Field>
          <Field label="Key specs" optional error={e.keySpecs?.message} helper="e.g. Deep hole drilling to 650 mm depth at 20 mm diameter" className="md:col-span-2">
            {(p) => <Textarea {...p} rows={2} {...register("keySpecs")} maxLength={1000} />}
          </Field>
          <Field label="Test standards" optional error={e.testStandards?.message} helper="For lab machines, e.g. ASTM D1238, ISO 1133">
            {(p) => <Input {...p} {...register("testStandards")} maxLength={500} />}
          </Field>
          <Controller
            control={control}
            name="nablAccredited"
            render={({ field }) => (
              <label className="flex min-h-11 items-center justify-between gap-3 self-end rounded-xl border px-4 py-2.5">
                <span>
                  <span className="block font-medium">NABL accredited</span>
                  <span className="text-sm text-muted-foreground">Tests on this machine are accredited</span>
                </span>
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              </label>
            )}
          />
        </div>
      </FormSection>

      <FormSection title="How it's booked" description="Used when booking time and working out when a job ends." icon={<Timer className="size-5" />}>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <Field label="Jobs at the same time" required error={e.parallelJobs?.message} helper="1 for most machines. More for chambers that hold several customers' samples at once.">
            {(p) => <Input {...p} type="number" min={1} max={50} step={1} inputMode="numeric" {...register("parallelJobs", num)} />}
          </Field>
          <Field label="Status" required error={e.status?.message}>
            {(p) => (
              <Controller
                control={control}
                name="status"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger {...p} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(MACHINE_STATUS) as MachineStatusName[]).map((s) => (
                        <SelectItem key={s} value={s}>
                          {MACHINE_STATUS[s].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            )}
          </Field>
          <Controller
            control={control}
            name="runsNonstop"
            render={({ field }) => (
              <label className="flex min-h-11 items-center justify-between gap-3 rounded-xl border px-4 py-2.5 md:col-span-2">
                <span>
                  <span className="block font-medium">Runs day and night</span>
                  <span className="text-sm text-muted-foreground">On for chambers and ovens that run tests non-stop (they ignore working hours and holidays). Off for machines that need an operator.</span>
                </span>
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              </label>
            )}
          />
          <Field label="Notes" optional error={e.notes?.message} className="md:col-span-2">
            {(p) => <Textarea {...p} rows={2} {...register("notes")} maxLength={2000} />}
          </Field>
        </div>
      </FormSection>

      <FormSection
        title="Services it can run"
        description="From the whole rate card, not only this department. A machine with none is shown as “Not on rate card”; jobs quoted as custom items can still be booked on it."
        icon={<Tags className="size-5" />}
      >
        <Controller
          control={control}
          name="serviceIds"
          render={({ field }) => (
            <div className="flex flex-col gap-4">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Find a service" className="h-11 pl-9" aria-label="Find a service" />
              </div>
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {picked.length ? `${picked.length} ${picked.length === 1 ? "service" : "services"} chosen` : "None chosen: shown as “Not on rate card”"}
              </p>
              {options.departments.map((d) => {
                const list = options.services.filter((s) => s.deptCode === d.code && (s.isActive || field.value.includes(s.id)) && (!needle || s.name.toLowerCase().includes(needle)));
                if (!list.length) return null;
                return (
                  <fieldset key={d.code}>
                    <legend className="mb-2 text-sm font-semibold">
                      {d.code} - {d.name}
                    </legend>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {list.map((s) => {
                        const on = field.value.includes(s.id);
                        return (
                          <label key={s.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 hover:bg-secondary/60">
                            <Checkbox checked={on} onCheckedChange={(v) => field.onChange(v === true ? [...field.value, s.id] : field.value.filter((x) => x !== s.id))} />
                            <span className="min-w-0">
                              <span className="block text-sm font-medium">{s.name}</span>
                              <span className="text-xs text-muted-foreground">{s.unitLabel}</span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                );
              })}
            </div>
          )}
        />
      </FormSection>

      <div className="sticky bottom-20 z-10 flex items-center justify-between gap-3 rounded-2xl border bg-card/95 p-4 shadow-lg backdrop-blur md:bottom-4">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {formState.isDirty ? "You have unsaved changes." : machineId ? "All changes saved." : "Fill in the machine, then save."}
        </p>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />} Save machine
        </Button>
      </div>
    </form>
  );
}
