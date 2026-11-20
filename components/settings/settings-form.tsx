"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { BellRing, Building2, Handshake, Package, FileText, ImageIcon, Loader2, Percent, Save, SquareKanban } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { saveSettings } from "@/lib/actions/settings";
import { Field, FormSection } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useUnsavedChangesWarning } from "@/hooks/use-unsaved-changes";
import { financialYear, formatQuoteNo } from "@/lib/pricing";
import { INDIAN_STATES } from "@/lib/india";
import {
  DEFAULT_EMAIL_BODY_TEMPLATE,
  DEFAULT_EMAIL_SUBJECT_TEMPLATE,
  DEFAULT_WHATSAPP_TEMPLATE,
  fillTemplate,
  TEMPLATE_PLACEHOLDERS,
  type TemplateValues,
} from "@/lib/reminder-templates";
import { DEFAULT_TERMS } from "@/lib/settings-shared";
import {
  DEFAULT_ORDER_EMAIL_BODY_TEMPLATE,
  DEFAULT_ORDER_EMAIL_SUBJECT_TEMPLATE,
  DEFAULT_ORDER_WHATSAPP_TEMPLATE,
  fillOrderTemplate,
  ORDER_TEMPLATE_PLACEHOLDERS,
} from "@/lib/inventory/templates";
import {
  DEFAULT_LEAD_EMAIL_BODY_TEMPLATE,
  DEFAULT_LEAD_EMAIL_SUBJECT_TEMPLATE,
  DEFAULT_LEAD_WHATSAPP_TEMPLATE,
  fillLeadTemplate,
  LEAD_TEMPLATE_PLACEHOLDERS,
} from "@/lib/crm/templates";

const ORDER_SAMPLE = {
  supplier: "Deccan Resins & Polymers",
  contact_name: "Mr. Kale",
  items: "1. SLA resin, imported (grey): 3 bottles (3,000 ml)\n2. IPA for cleaning: 2 cans (10 L)",
  org_name: "AutoCluster",
  date: "20 Nov 2026",
};
const LEAD_SAMPLE = { contact_name: "Rohan Kulkarni", company: "Sahyadri Auto Components Pvt Ltd", enquiry_title: "3D printing of 20 prototype parts" };
const DONT_MOVE = "none";

const SAMPLE_VALUES: TemplateValues = {
  company: "Sahyadri Auto Components Pvt Ltd",
  contact_name: "Rohan Kulkarni",
  invoice_no: "MCCIA/2026-27/0456",
  invoice_date: "10 Nov 2026",
  amount_due: "8,496",
  due_date: "10 Dec 2026",
  days_overdue: "0",
};
import { settingsSchema, type SettingsInput } from "@/lib/validation/settings";

export function SettingsForm({ initial, stages }: { initial: SettingsInput; stages: { id: string; name: string; type: "OPEN" | "WON" | "LOST" }[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const form = useForm<SettingsInput>({ resolver: zodResolver(settingsSchema), defaultValues: initial, mode: "onTouched" });
  const { register, control, handleSubmit, formState, reset, setValue } = form;
  const e = formState.errors;
  useUnsavedChangesWarning(formState.isDirty);

  const onSubmit = (ev: React.FormEvent<HTMLFormElement>) =>
    handleSubmit(
    (v) =>
      startTransition(async () => {
        const res = await saveSettings(v);
        if (!res.ok) return void toast.error(res.message);
        reset(v);
        toast.success("Settings saved");
        router.refresh();
      }),
    () => toast.error("Some settings need a second look. Please check the fields marked in red."),
  )(ev);

  const num = { valueAsNumber: true } as const;
  const prefix = useWatch({ control, name: "quotePrefix" }) || "ACDRI/QT";
  const ticketPrefix = useWatch({ control, name: "ticketPrefix" }) || "ACDRI/TK";
  const whatsapp = useWatch({ control, name: "whatsappTemplate" });
  const leadPrefix = useWatch({ control, name: "leadPrefix" }) || "ACDRI/EN";
  const leadWhatsapp = useWatch({ control, name: "leadWhatsappTemplate" });
  const wonStage = stages.find((st) => st.type === "WON")?.name ?? "Won";
  const invIn = useWatch({ control, name: "invInPrefix" }) || "ACDRI/IN";
  const invOut = useWatch({ control, name: "invOutPrefix" }) || "ACDRI/OUT";
  const invAdj = useWatch({ control, name: "invAdjPrefix" }) || "ACDRI/ADJ";
  const invItem = useWatch({ control, name: "invItemPrefix" }) || "ITM";
  const orderWa = useWatch({ control, name: "invOrderWhatsappTemplate" });
  const pct = useWatch({ control, name: "memberDiscountPct" });
  const applyNonMsme = useWatch({ control, name: "applyDiscountToNonMsme" });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <FormSection title="Organisation profile" description="Printed at the top of every quotation." icon={<Building2 className="size-5" />}>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <Field label="Organisation name" required error={e.orgName?.message} className="md:col-span-2">
            {(p) => <Input {...p} {...register("orgName")} />}
          </Field>
          <Field label="Address" required error={e.orgAddress?.message} className="md:col-span-2">
            {(p) => <Textarea {...p} rows={2} {...register("orgAddress")} />}
          </Field>
          <Field label="GST number (GSTIN)" required error={e.orgGstin?.message} helper="15 characters, e.g. 27AABCU9603R1ZM">
            {(p) => (
              <Input
                {...p}
                className="font-mono uppercase"
                maxLength={15}
                {...register("orgGstin", { onChange: (ev) => setValue("orgGstin", ev.target.value.toUpperCase()) })}
              />
            )}
          </Field>
          <Field label="Phone" required error={e.orgPhone?.message} helper="e.g. 020 2712 0000">
            {(p) => <Input {...p} type="tel" {...register("orgPhone")} />}
          </Field>
          <Field label="Email" required error={e.orgEmail?.message} className="md:col-span-2" helper="e.g. info@autocluster.org">
            {(p) => <Input {...p} type="email" {...register("orgEmail")} />}
          </Field>
          <div className="flex min-w-0 flex-wrap items-center gap-4 rounded-xl border border-dashed p-4 md:col-span-2">
            <span className="grid size-14 place-items-center rounded-xl bg-primary font-title text-xl text-primary-foreground">AC</span>
            <div className="min-w-40 flex-1">
              <p className="font-medium">Logo</p>
              <p className="text-sm text-muted-foreground">A placeholder is used for the demo. Logo upload will come later.</p>
            </div>
            <Button type="button" variant="outline" disabled>
              <ImageIcon aria-hidden /> Upload logo
            </Button>
          </div>
        </div>
      </FormSection>

      <FormSection title="Discounts and tax" description="Used to work out every price." icon={<Percent className="size-5" />}>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <Field label="MCCIA member discount (%)" required error={e.memberDiscountPct?.message} helper="Taken off the rate for MCCIA members, e.g. 10">
            {(p) => <Input {...p} type="number" min={0} max={100} step="any" inputMode="decimal" {...register("memberDiscountPct", num)} />}
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-base font-medium">Also apply to non-MSME members</span>
            <label className="flex min-h-11 items-center gap-3">
              <Controller
                control={control}
                name="applyDiscountToNonMsme"
                render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} aria-label="Also apply to non-MSME members" />}
              />
              <span>{applyNonMsme ? "Yes" : "No"}</span>
            </label>
            <p className="text-sm text-muted-foreground">
              {applyNonMsme
                ? `OEM, Tier 1 and Tier 2 members also get ${Number.isFinite(pct) ? pct : 10}% off the OEM rate.`
                : "Only MSME members get the discount."}
            </p>
          </div>
          <Field label="GST (%)" required error={e.gstPct?.message} helper="e.g. 18. Split into CGST + SGST within the home state, IGST outside it.">
            {(p) => <Input {...p} type="number" min={0} max={100} step="any" inputMode="decimal" {...register("gstPct", num)} />}
          </Field>
          <Field label="Home state" required error={e.homeStateCode?.message} helper="Customers in this state pay CGST + SGST.">
            {(p) => (
              <Controller
                control={control}
                name="homeStateCode"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger {...p} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-80">
                      {INDIAN_STATES.map((s) => (
                        <SelectItem key={s.code} value={s.code}>
                          {s.name} ({s.code})
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

      <FormSection title="Quotations" icon={<FileText className="size-5" />}>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <Field label="Valid for (days)" required error={e.quoteValidityDays?.message} helper="Sets the default “Valid until” date, e.g. 30">
            {(p) => <Input {...p} type="number" min={1} max={365} step={1} inputMode="numeric" {...register("quoteValidityDays", num)} />}
          </Field>
          <Field
            label="Number prefix"
            required
            error={e.quotePrefix?.message}
            helper={`Quotation numbers will look like ${formatQuoteNo(prefix.toUpperCase(), financialYear(new Date()), 1)}`}
          >
            {(p) => <Input {...p} className="uppercase" {...register("quotePrefix")} />}
          </Field>
          <Field
            label="Default terms and conditions"
            required
            error={e.defaultTerms?.message}
            className="md:col-span-2"
            helper={
              <>
                Filled in on new quotations. Staff can still change them on each quotation.{" "}
                <button
                  type="button"
                  className="font-medium text-primary underline-offset-4 hover:underline"
                  onClick={() => setValue("defaultTerms", DEFAULT_TERMS, { shouldDirty: true })}
                >
                  Use the standard terms
                </button>
              </>
            }
          >
            {(p) => <Textarea {...p} rows={8} {...register("defaultTerms")} />}
          </Field>
        </div>
      </FormSection>

      <FormSection title="Orders & Billing" description="Ticket numbers and payment terms." icon={<SquareKanban className="size-5" />}>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <Field
            label="Ticket number prefix"
            required
            error={e.ticketPrefix?.message}
            helper={`New tickets will look like ${formatQuoteNo(ticketPrefix.toUpperCase(), financialYear(new Date()), 1)}. Existing tickets keep their numbers.`}
          >
            {(p) => <Input {...p} className="uppercase" {...register("ticketPrefix")} />}
          </Field>
          <Field label="Default credit period (days)" required error={e.defaultCreditDays?.message} helper="Filled in for new customers, e.g. 30. Each customer can have their own.">
            {(p) => <Input {...p} type="number" min={0} max={365} step={1} inputMode="numeric" {...register("defaultCreditDays", num)} />}
          </Field>
        </div>
      </FormSection>

      <FormSection title="Payment reminders" description="The ready-written WhatsApp and email messages. Staff check them and press send." icon={<BellRing className="size-5" />}>
        <div className="flex flex-col gap-5">
          <p className="text-sm text-muted-foreground">
            These words are filled in for you:{" "}
            {TEMPLATE_PLACEHOLDERS.map((ph) => (
              <code key={ph} className="mr-1 rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">
                {ph}
              </code>
            ))}
          </p>
          <Field
            label="WhatsApp message"
            required
            error={e.whatsappTemplate?.message}
            helper={
              <>
                Preview: <span className="text-foreground">{fillTemplate(whatsapp ?? "", SAMPLE_VALUES)}</span>{" "}
                <button type="button" className="font-medium text-primary underline-offset-4 hover:underline" onClick={() => setValue("whatsappTemplate", DEFAULT_WHATSAPP_TEMPLATE, { shouldDirty: true, shouldValidate: true })}>
                  Use the standard wording
                </button>
              </>
            }
          >
            {(p) => <Textarea {...p} rows={4} {...register("whatsappTemplate")} />}
          </Field>
          <Field label="Email subject" required error={e.emailSubjectTemplate?.message}>
            {(p) => <Input {...p} {...register("emailSubjectTemplate")} />}
          </Field>
          <Field
            label="Email message"
            required
            error={e.emailBodyTemplate?.message}
            helper={
              <button
                type="button"
                className="font-medium text-primary underline-offset-4 hover:underline"
                onClick={() => {
                  setValue("emailSubjectTemplate", DEFAULT_EMAIL_SUBJECT_TEMPLATE, { shouldDirty: true, shouldValidate: true });
                  setValue("emailBodyTemplate", DEFAULT_EMAIL_BODY_TEMPLATE, { shouldDirty: true, shouldValidate: true });
                }}
              >
                Use the standard email
              </button>
            }
          >
            {(p) => <Textarea {...p} rows={10} {...register("emailBodyTemplate")} />}
          </Field>
        </div>
      </FormSection>

      <FormSection title="CRM" description="Enquiry numbers, contact messages and automatic moves." icon={<Handshake className="size-5" />}>
        <div className="flex flex-col gap-5">
          <Field
            label="Enquiry number prefix"
            required
            error={e.leadPrefix?.message}
            helper={`New enquiries will look like ${formatQuoteNo(leadPrefix.toUpperCase(), financialYear(new Date()), 1)}. Existing enquiries keep their numbers.`}
          >
            {(p) => <Input {...p} className="uppercase md:max-w-sm" {...register("leadPrefix")} />}
          </Field>
          <p className="text-sm text-muted-foreground">
            In the messages below, these words are filled in for you:{" "}
            {LEAD_TEMPLATE_PLACEHOLDERS.map((ph) => (
              <code key={ph} className="mr-1 rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">
                {ph}
              </code>
            ))}
          </p>
          <Field
            label="WhatsApp message for enquiries"
            required
            error={e.leadWhatsappTemplate?.message}
            helper={
              <>
                Preview: <span className="text-foreground">{fillLeadTemplate(leadWhatsapp ?? "", LEAD_SAMPLE)}</span>{" "}
                <button type="button" className="font-medium text-primary underline-offset-4 hover:underline" onClick={() => setValue("leadWhatsappTemplate", DEFAULT_LEAD_WHATSAPP_TEMPLATE, { shouldDirty: true, shouldValidate: true })}>
                  Use the standard wording
                </button>
              </>
            }
          >
            {(p) => <Textarea {...p} rows={3} {...register("leadWhatsappTemplate")} />}
          </Field>
          <Field label="Email subject for enquiries" required error={e.leadEmailSubjectTemplate?.message}>
            {(p) => <Input {...p} {...register("leadEmailSubjectTemplate")} />}
          </Field>
          <Field
            label="Email message for enquiries"
            required
            error={e.leadEmailBodyTemplate?.message}
            helper={
              <button
                type="button"
                className="font-medium text-primary underline-offset-4 hover:underline"
                onClick={() => {
                  setValue("leadEmailSubjectTemplate", DEFAULT_LEAD_EMAIL_SUBJECT_TEMPLATE, { shouldDirty: true, shouldValidate: true });
                  setValue("leadEmailBodyTemplate", DEFAULT_LEAD_EMAIL_BODY_TEMPLATE, { shouldDirty: true, shouldValidate: true });
                }}
              >
                Use the standard email
              </button>
            }
          >
            {(p) => <Textarea {...p} rows={8} {...register("leadEmailBodyTemplate")} />}
          </Field>
          <div className="flex flex-col gap-3 rounded-xl border bg-muted/30 p-4">
            <p className="font-medium">Automatic moves</p>
            <Field label="When a quotation is created from an enquiry, move it to:" error={e.quoteCreatedMoveToStageId?.message}>
              {(p) => (
                <Controller
                  control={control}
                  name="quoteCreatedMoveToStageId"
                  render={({ field }) => (
                    <Select value={field.value || DONT_MOVE} onValueChange={(v) => field.onChange(v === DONT_MOVE ? "" : v)}>
                      <SelectTrigger {...p} className="w-full md:max-w-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={DONT_MOVE}>Don&apos;t move</SelectItem>
                        {stages
                          .filter((st) => st.type === "OPEN")
                          .map((st) => (
                            <SelectItem key={st.id} value={st.id}>
                              {st.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              )}
            </Field>
            <p className="text-sm text-muted-foreground">
              When that quotation is <strong className="text-foreground">Accepted</strong>, the enquiry is always marked as <strong className="text-foreground">{wonStage}</strong>.
            </p>
          </div>
        </div>
      </FormSection>

      <FormSection title="Inventory" description="Numbers, warnings and the supplier order message." icon={<Package className="size-5" />}>
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <Field label="Stock received number prefix" required error={e.invInPrefix?.message} helper={`e.g. ${formatQuoteNo(invIn.toUpperCase(), financialYear(new Date()), 1)}`}>
              {(p) => <Input {...p} className="uppercase" {...register("invInPrefix")} />}
            </Field>
            <Field label="Stock used number prefix" required error={e.invOutPrefix?.message} helper={`e.g. ${formatQuoteNo(invOut.toUpperCase(), financialYear(new Date()), 1)}`}>
              {(p) => <Input {...p} className="uppercase" {...register("invOutPrefix")} />}
            </Field>
            <Field label="Stock adjusted number prefix" required error={e.invAdjPrefix?.message} helper={`e.g. ${formatQuoteNo(invAdj.toUpperCase(), financialYear(new Date()), 1)}`}>
              {(p) => <Input {...p} className="uppercase" {...register("invAdjPrefix")} />}
            </Field>
            <Field label="Item code prefix" required error={e.invItemPrefix?.message} helper={`New items get codes like ${invItem.toUpperCase()}-0001`}>
              {(p) => <Input {...p} className="uppercase" {...register("invItemPrefix")} />}
            </Field>
            <Field label="Warn about expiry (days before)" required error={e.invExpiryWarningDays?.message} helper="Batches expiring within this many days show “Expiring soon”, e.g. 30">
              {(p) => <Input {...p} type="number" min={1} max={365} step={1} inputMode="numeric" {...register("invExpiryWarningDays", num)} />}
            </Field>
            <Field label="Days used for average use" required error={e.invAvgUseDays?.message} helper="“Runs out in” is worked out from use over this many days, e.g. 90">
              {(p) => <Input {...p} type="number" min={7} max={730} step={1} inputMode="numeric" {...register("invAvgUseDays", num)} />}
            </Field>
            <Field label="Safety days" required error={e.invSafetyDays?.message} helper="Extra days added to the supplier's delivery time before an item is put on the reorder list, e.g. 7">
              {(p) => <Input {...p} type="number" min={0} max={365} step={1} inputMode="numeric" {...register("invSafetyDays", num)} />}
            </Field>
            <Field label="Price rise alert (%)" required error={e.invPriceRiseAlertPct?.message} helper="Flag items whose purchase rate rose more than this, e.g. 10">
              {(p) => <Input {...p} type="number" min={1} max={100} step={1} inputMode="numeric" {...register("invPriceRiseAlertPct", num)} />}
            </Field>
            <Field label="High material share alert (%)" required error={e.invMaterialShareAlertPct?.message} helper="Flag services where materials take more than this share of the price, e.g. 40">
              {(p) => <Input {...p} type="number" min={1} max={100} step={1} inputMode="numeric" {...register("invMaterialShareAlertPct", num)} />}
            </Field>
          </div>
          <p className="text-sm text-muted-foreground">
            In the supplier order messages, these words are filled in for you:{" "}
            {ORDER_TEMPLATE_PLACEHOLDERS.map((ph) => (
              <code key={ph} className="mr-1 rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">
                {ph}
              </code>
            ))}
          </p>
          <Field
            label="WhatsApp message to suppliers"
            required
            error={e.invOrderWhatsappTemplate?.message}
            helper={
              <>
                Preview: <span className="whitespace-pre-line text-foreground">{fillOrderTemplate(orderWa ?? "", ORDER_SAMPLE)}</span>{" "}
                <button type="button" className="font-medium text-primary underline-offset-4 hover:underline" onClick={() => setValue("invOrderWhatsappTemplate", DEFAULT_ORDER_WHATSAPP_TEMPLATE, { shouldDirty: true, shouldValidate: true })}>
                  Use the standard wording
                </button>
              </>
            }
          >
            {(p) => <Textarea {...p} rows={5} {...register("invOrderWhatsappTemplate")} />}
          </Field>
          <Field label="Email subject to suppliers" required error={e.invOrderEmailSubjectTemplate?.message}>
            {(p) => <Input {...p} {...register("invOrderEmailSubjectTemplate")} />}
          </Field>
          <Field
            label="Email message to suppliers"
            required
            error={e.invOrderEmailBodyTemplate?.message}
            helper={
              <button
                type="button"
                className="font-medium text-primary underline-offset-4 hover:underline"
                onClick={() => {
                  setValue("invOrderEmailSubjectTemplate", DEFAULT_ORDER_EMAIL_SUBJECT_TEMPLATE, { shouldDirty: true, shouldValidate: true });
                  setValue("invOrderEmailBodyTemplate", DEFAULT_ORDER_EMAIL_BODY_TEMPLATE, { shouldDirty: true, shouldValidate: true });
                }}
              >
                Use the standard email
              </button>
            }
          >
            {(p) => <Textarea {...p} rows={8} {...register("invOrderEmailBodyTemplate")} />}
          </Field>
        </div>
      </FormSection>

      <div className="sticky bottom-20 z-10 flex items-center justify-between gap-3 rounded-2xl border bg-card/95 p-4 shadow-lg backdrop-blur md:bottom-4">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {formState.isDirty ? "You have unsaved changes." : "All changes saved."}
        </p>
        <Button type="submit" size="lg" disabled={pending || !formState.isDirty}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
          Save settings
        </Button>
      </div>
    </form>
  );
}
