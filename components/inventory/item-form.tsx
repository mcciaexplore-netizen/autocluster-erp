"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Boxes, Info, Loader2, Package, Save, Truck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { Field, FormSection } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useUnsavedChangesWarning } from "@/hooks/use-unsaved-changes";
import { saveItemAction } from "@/lib/actions/inventory";
import type { ItemFormOptions } from "@/lib/inventory-data";
import { formatQty, parseQty } from "@/lib/inventory/numbers";
import { cn } from "@/lib/utils";
import { itemFormSchema, type ItemFormValues } from "@/lib/validation/inventory";

const NONE = "none";

/** Add or edit an item. Stock is never typed here: it changes only through Stock received, Use stock and Adjust stock. */
export function ItemForm({ itemId, initial, options, currentQty = "0" }: { itemId: string | null; initial: ItemFormValues; options: ItemFormOptions; currentQty?: string }) {
  // The unit can't change once there is stock (the numbers would then mean something else).
  const unitLocked = Number(currentQty) > 0;
  const router = useRouter();
  const [pending, start] = useTransition();
  const form = useForm<ItemFormValues>({ resolver: zodResolver(itemFormSchema), defaultValues: initial, mode: "onTouched" });
  const { register, control, handleSubmit, formState, setValue } = form;
  const e = formState.errors;
  useUnsavedChangesWarning(formState.isDirty);
  const w = useWatch({ control });
  const unit = options.units.find((u) => u.id === w.unitId)?.name ?? "";
  const dirty = { shouldDirty: true, shouldValidate: formState.isSubmitted } as const;
  const active = <T extends { isActive: boolean; id: string }>(list: T[], keep?: string) => list.filter((x) => x.isActive || x.id === keep);

  const onSubmit = (ev: React.FormEvent<HTMLFormElement>) =>
    handleSubmit(
      (v) =>
        start(async () => {
          const r = await saveItemAction(itemId, v, itemId ? undefined : options.nextCode);
          if (!r.ok) return void toast.error(r.message);
          form.reset(v);
          toast.success(itemId ? "Item saved" : `Item ${r.data.code} added`);
          router.push(`/inventory/items/${r.data.id}`);
          router.refresh();
        }),
      () => toast.error("Some details need a second look. Please check the fields marked in red."),
    )(ev);

  const pack = parseQty(w.packSize ?? "");
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <FormSection title="Item" icon={<Package className="size-5" />}>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <Field label="Item name" required error={e.name?.message} helper="e.g. SLA resin, imported (grey)" className="md:col-span-2">
            {(p) => <Input {...p} {...register("name")} maxLength={120} />}
          </Field>
          <Field label="Item code" error={e.code?.message} helper={itemId ? "Must be unique." : `Given automatically (next: ${options.nextCode}). You can type your own.`}>
            {(p) => <Input {...p} className="uppercase" placeholder={itemId ? undefined : options.nextCode} {...register("code")} maxLength={30} />}
          </Field>
          <Field label="Category" required error={e.categoryId?.message}>
            {(p) => (
              <Controller
                control={control}
                name="categoryId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger {...p} className="w-full">
                      <SelectValue placeholder="Choose category" />
                    </SelectTrigger>
                    <SelectContent>
                      {active(options.categories, initial.categoryId).map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            )}
          </Field>
          <div className="flex flex-col gap-2 md:col-span-2">
            <span className="text-base font-medium">
              Department(s) <span className="font-normal text-muted-foreground">(optional)</span>
            </span>
            <div role="group" aria-label="Departments" className="flex flex-wrap gap-2">
              {options.departments.map((d) => {
                const on = (w.deptCodes ?? []).includes(d.code);
                return (
                  <button
                    key={d.code}
                    type="button"
                    aria-pressed={on}
                    title={d.name}
                    onClick={() => setValue("deptCodes", on ? (w.deptCodes ?? []).filter((x) => x !== d.code) : [...(w.deptCodes ?? []), d.code], dirty)}
                    className={cn("inline-flex h-10 items-center rounded-full border px-4 text-sm font-medium", on ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-primary/40")}
                  >
                    {d.code} <span className={cn("ml-1.5 hidden font-normal sm:inline", on ? "text-primary-foreground/80" : "text-muted-foreground")}>{d.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </FormSection>

      <FormSection title="Units and reorder" description="How stock is counted, and when to order more." icon={<Boxes className="size-5" />}>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <Field label="Unit" required error={e.unitId?.message} helper={unitLocked ? "Can't be changed while the item has stock." : "Stock is counted in this unit, e.g. ml"}>
            {(p) => (
              <Controller
                control={control}
                name="unitId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange} disabled={unitLocked}>
                    <SelectTrigger {...p} className="w-full">
                      <SelectValue placeholder="Choose unit" />
                    </SelectTrigger>
                    <SelectContent>
                      {active(options.units, initial.unitId).map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Pack name" optional error={e.packName?.message} helper="e.g. Bottle">
              {(p) => <Input {...p} {...register("packName")} maxLength={30} />}
            </Field>
            <Field label={`Pack size${unit ? ` (${unit})` : ""}`} optional error={e.packSize?.message} helper="e.g. 1000">
              {(p) => <Input {...p} inputMode="decimal" {...register("packSize")} />}
            </Field>
          </div>
          {w.packName && pack ? (
            <p className="flex items-start gap-2 rounded-xl bg-secondary p-3 text-sm md:col-span-2">
              <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              Staff can receive stock as “3 {w.packName.toLowerCase()}s” instead of “{formatQty(Number(pack) * 3, unit)}”.
            </p>
          ) : null}
          <Field label={`Reorder level${unit ? ` (${unit})` : ""}`} required error={e.reorderLevel?.message} helper="Warn me when stock falls to this, e.g. 1000">
            {(p) => <Input {...p} inputMode="decimal" {...register("reorderLevel")} />}
          </Field>
          <Field label={`Reorder quantity${unit ? ` (${unit})` : ""}`} required error={e.reorderQty?.message} helper="How much I usually order, e.g. 3000">
            {(p) => <Input {...p} inputMode="decimal" {...register("reorderQty")} />}
          </Field>
          <Field label="Supplier lead time (days)" optional error={e.leadTimeDays?.message} helper="How many days the supplier takes to deliver, e.g. 7">
            {(p) => <Input {...p} type="number" min={0} max={365} inputMode="numeric" {...register("leadTimeDays")} />}
          </Field>
          <Field label="Preferred supplier" optional>
            {(p) => (
              <Controller
                control={control}
                name="preferredSupplierId"
                render={({ field }) => (
                  <Select value={field.value || NONE} onValueChange={(v) => field.onChange(v === NONE ? "" : v)}>
                    <SelectTrigger {...p} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>No preferred supplier</SelectItem>
                      {active(options.suppliers, initial.preferredSupplierId).map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            )}
          </Field>
        </div>
      </FormSection>

      <FormSection title="More details" icon={<Truck className="size-5" />}>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <Field label="Where it's kept" optional error={e.storagePlace?.message} helper="e.g. RPT lab, rack 2">
            {(p) => <Input {...p} {...register("storagePlace")} maxLength={120} />}
          </Field>
          <Field label="HSN code" optional error={e.hsnCode?.message} helper="e.g. 3907">
            {(p) => <Input {...p} inputMode="numeric" {...register("hsnCode")} maxLength={8} />}
          </Field>
          <SwitchRow
            control={control}
            name="trackBatches"
            label="Track batches and expiry"
            help="Turn on for resins, powders and chemicals. Each delivery then needs a batch number and expiry date, and use picks the batch that expires first."
          />
          <SwitchRow control={control} name="isActive" label="Active" help="Inactive items are hidden from forms, but their history stays." />
          <Field label="Notes" optional className="md:col-span-2">
            {(p) => <Textarea {...p} rows={3} {...register("notes")} maxLength={2000} />}
          </Field>
        </div>
      </FormSection>

      <div className="sticky bottom-20 z-10 flex items-center justify-between gap-3 rounded-2xl border bg-card/95 p-4 shadow-lg backdrop-blur md:bottom-4">
        <p className="text-sm text-muted-foreground">{formState.isDirty ? "You have unsaved changes." : itemId ? "All changes saved." : "Fill in the item, then save."}</p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
            {itemId ? "Save item" : "Add item"}
          </Button>
        </div>
      </div>
    </form>
  );
}

function SwitchRow({ control, name, label, help }: { control: ReturnType<typeof useForm<ItemFormValues>>["control"]; name: "trackBatches" | "isActive"; label: string; help: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex min-h-11 items-center gap-3">
        <Controller control={control} name={name} render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} aria-label={label} />} />
        <span className="text-base font-medium">{label}</span>
      </label>
      <p className="text-sm text-muted-foreground">{help}</p>
    </div>
  );
}
