"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Save, Store } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { Field, FormSection } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useUnsavedChangesWarning } from "@/hooks/use-unsaved-changes";
import { saveSupplierAction } from "@/lib/actions/inventory";
import { supplierFormSchema, type SupplierFormValues } from "@/lib/validation/inventory";

/** Add or edit a supplier. `onSaved` lets other screens (e.g. Stock received) add one without leaving. */
export function SupplierForm({
  supplierId,
  initial,
  onSaved,
  onCancel,
}: {
  supplierId: string | null;
  initial: SupplierFormValues;
  onSaved?: (s: { id: string; name: string }) => void;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const form = useForm<SupplierFormValues>({ resolver: zodResolver(supplierFormSchema), defaultValues: initial, mode: "onTouched" });
  const { register, control, handleSubmit, formState, setValue } = form;
  const e = formState.errors;
  useUnsavedChangesWarning(formState.isDirty && !onSaved);

  const onSubmit = (ev: React.FormEvent<HTMLFormElement>) => {
    ev.stopPropagation();
    return handleSubmit(
      (v) =>
        start(async () => {
          const r = await saveSupplierAction(supplierId, v);
          if (!r.ok) return void toast.error(r.message);
          form.reset(v);
          toast.success(supplierId ? "Supplier saved" : `Supplier “${r.data.name}” added`);
          if (onSaved) return onSaved(r.data);
          router.push(`/inventory/suppliers/${r.data.id}`);
          router.refresh();
        }),
      () => toast.error("Some details need a second look. Please check the fields marked in red."),
    )(ev);
  };

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <FormSection title="Supplier" icon={<Store className="size-5" />}>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <Field label="Supplier name" required error={e.name?.message} helper="e.g. Deccan Resins & Polymers" className="md:col-span-2">
            {(p) => <Input {...p} {...register("name")} maxLength={120} autoFocus={!!onSaved} />}
          </Field>
          <Field label="Contact person" optional error={e.contactName?.message}>
            {(p) => <Input {...p} {...register("contactName")} maxLength={80} />}
          </Field>
          <Field label="Mobile" optional error={e.phone?.message} helper="10 digits, used for WhatsApp orders">
            {(p) => (
              <div className="flex min-w-0 items-center rounded-xl border bg-card focus-within:ring-2 focus-within:ring-ring">
                <span className="pl-3 text-muted-foreground">+91</span>
                <Input {...p} type="tel" inputMode="numeric" className="border-0 shadow-none focus-visible:ring-0" {...register("phone")} maxLength={16} />
              </div>
            )}
          </Field>
          <Field label="Email" optional error={e.email?.message} helper="e.g. sales@supplier.com">
            {(p) => <Input {...p} type="email" {...register("email")} maxLength={200} />}
          </Field>
          <Field label="GST number (GSTIN)" optional error={e.gstin?.message} helper="15 characters, e.g. 27AABCU9603R1ZM">
            {(p) => (
              <Input
                {...p}
                className="font-mono uppercase"
                maxLength={15}
                {...register("gstin", { onChange: (ev) => setValue("gstin", ev.target.value.toUpperCase()) })}
              />
            )}
          </Field>
          <Field label="Address" optional error={e.address?.message} className="md:col-span-2">
            {(p) => <Textarea {...p} rows={2} {...register("address")} maxLength={400} />}
          </Field>
          <Field label="Notes" optional className="md:col-span-2" helper="e.g. Delivers on Tuesdays and Fridays">
            {(p) => <Textarea {...p} rows={2} {...register("notes")} maxLength={2000} />}
          </Field>
          <label className="flex min-h-11 items-center gap-3">
            <Controller control={control} name="isActive" render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} aria-label="Active" />} />
            <span className="text-base font-medium">Active</span>
          </label>
        </div>
      </FormSection>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => (onCancel ? onCancel() : router.back())}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
          {supplierId ? "Save supplier" : "Add supplier"}
        </Button>
      </div>
    </form>
  );
}
