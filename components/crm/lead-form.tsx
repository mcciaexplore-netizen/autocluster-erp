"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, Building2, ClipboardList, Expand, Loader2, NotebookPen, Plus, Save } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/common/confirm";
import { useEffect, useState, useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { Field } from "@/components/forms/field";
import { CustomerPicker } from "@/components/quotations/builder/customer-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useUnsavedChangesWarning } from "@/hooks/use-unsaved-changes";
import { createLeadAction, createTagAction, findDuplicatesAction, updateLeadAction } from "@/lib/actions/crm";
import type { LeadFormOptions } from "@/lib/crm-data";
import type { Duplicates } from "@/db/lead-writer";
import { CATEGORY_LABELS } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import { leadFormSchema, type LeadFormValues } from "@/lib/validation/lead";
import { PriorityStars } from "./lead-bits";

/** Saved by "Open full page", read by the full page, so nothing typed is lost. */
export const LEAD_DRAFT_KEY = "acdri-crm-lead-draft";

export function saveLeadDraft(values: LeadFormValues, leadId?: string) {
  try {
    sessionStorage.setItem(LEAD_DRAFT_KEY, JSON.stringify({ leadId: leadId ?? null, values }));
  } catch {}
}
export function takeLeadDraft(leadId?: string): LeadFormValues | null {
  try {
    const raw = sessionStorage.getItem(LEAD_DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as { leadId: string | null; values: LeadFormValues };
    if ((d.leadId ?? null) !== (leadId ?? null)) return null;
    sessionStorage.removeItem(LEAD_DRAFT_KEY);
    return d.values;
  } catch {
    return null;
  }
}

const CATS = ["OEM", "TIER1", "TIER2", "MSME"] as const;

export function LeadForm({
  mode,
  leadId,
  initial,
  options,
  onSaved,
  onCancel,
  fullPageHref,
  wide = false,
  restoreDraft = false,
  onDirtyChange,
}: {
  mode: "create" | "edit";
  leadId?: string;
  initial: LeadFormValues;
  options: LeadFormOptions;
  onSaved: (r: { id: string; leadNo?: string }) => void;
  onCancel: () => void;
  /** Shown in the side panel: opens the same form on its own page. */
  fullPageHref?: string;
  /** Full page: two columns on wide screens. */
  wide?: boolean;
  /** Full page: bring back what was typed in the side panel before "Open full page". */
  restoreDraft?: boolean;
  /** Tells the side panel whether there are unsaved changes (to warn before closing). */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const router = useRouter();
  const [dialog, confirm] = useConfirm();
  const [pending, start] = useTransition();
  const [tags, setTags] = useState(options.tags);
  const form = useForm<LeadFormValues>({ resolver: zodResolver(leadFormSchema), defaultValues: initial, mode: "onTouched" });
  const { register, control, handleSubmit, formState, setValue, getValues } = form;
  const e = formState.errors;
  useUnsavedChangesWarning(formState.isDirty);
  useEffect(() => onDirtyChange?.(formState.isDirty), [formState.isDirty, onDirtyChange]);
  const w = useWatch({ control });
  const dirty = { shouldDirty: true, shouldValidate: formState.isSubmitted } as const;

  useEffect(() => {
    if (!restoreDraft) return;
    const draft = takeLeadDraft(leadId);
    if (!draft) return;
    for (const [k, v] of Object.entries(draft)) setValue(k as keyof LeadFormValues, v as never, { shouldDirty: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- stages offered: never straight to Lost (that needs a reason) ----------------------
  const currentStage = options.stages.find((s) => s.id === initial.stageId);
  const stageChoices = options.stages.filter((s) => s.type !== "LOST" || s.id === initial.stageId);

  // ---- duplicate check (never blocks saving) ---------------------------------------------
  const [dups, setDups] = useState<Duplicates | null>(null);
  const phone = w.phone ?? "";
  const email = w.email ?? "";
  const company = w.companyName ?? "";
  const linkedId = w.existingCustomer ? (w.customerId ?? "") : "";
  useEffect(() => {
    const t = setTimeout(async () => {
      const r = await findDuplicatesAction({ phone, email, companyName: company, excludeLeadId: leadId ?? null, excludeCustomerId: linkedId || null });
      if (r.ok) setDups(r.data);
    }, 450);
    return () => clearTimeout(t);
  }, [phone, email, company, leadId, linkedId]);

  const linkCustomer = (id: string) => {
    const c = options.customers.find((x) => x.id === id);
    if (!c) return;
    setValue("existingCustomer", true, dirty);
    setValue("customerId", c.id, dirty);
    setValue("companyName", c.companyName, dirty);
    setValue("contactName", c.pocName, dirty);
    setValue("designation", c.pocDesignation ?? "", dirty);
    setValue("phone", c.pocPhone, dirty);
    setValue("email", c.pocEmail, dirty);
    setValue("city", c.city, dirty);
    setValue("category", c.category, dirty);
    setValue("isMcciaMember", c.isMcciaMember ? "yes" : "no", dirty);
    setValue("mcciaMembershipId", c.mcciaMembershipId ?? "", dirty);
  };

  // ---- services shown for the chosen departments ------------------------------------------
  const deptCodes = w.deptCodes ?? [];
  const serviceIds = (w.serviceIds ?? []) as number[];
  const visibleServices = options.services.filter((s) => deptCodes.includes(s.deptCode));
  const toggleDept = (code: string) => {
    const next = deptCodes.includes(code) ? deptCodes.filter((d) => d !== code) : [...deptCodes, code];
    setValue("deptCodes", next, dirty);
    // Drop services from departments that were un-ticked.
    const allowed = new Set(options.services.filter((s) => next.includes(s.deptCode)).map((s) => s.id));
    setValue(
      "serviceIds",
      serviceIds.filter((id) => allowed.has(id)),
      dirty,
    );
  };

  // ---- tags: pick or type a new one -------------------------------------------------------
  const tagIds = (w.tagIds ?? []) as string[];
  const [newTag, setNewTag] = useState("");
  const addTag = () => {
    const name = newTag.trim();
    if (!name) return;
    const existing = tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      if (!tagIds.includes(existing.id)) setValue("tagIds", [...tagIds, existing.id], dirty);
      setNewTag("");
      return;
    }
    start(async () => {
      const r = await createTagAction(name);
      if (!r.ok) return void toast.error(r.message);
      setTags((t) => [...t, r.data]);
      setValue("tagIds", [...tagIds, r.data.id], dirty);
      setNewTag("");
      toast.success(`New tag “${r.data.name}” added`);
    });
  };

  // After saving into Won (and not yet a customer): the same question as dragging to Won.
  const finish = async (saved: { id: string; leadNo?: string }, askConvert: boolean, company: string) => {
    if (askConvert) {
      const yes = await confirm({
        title: `Make ${company} a customer now?`,
        description: "You'll get the customer form with the enquiry's details filled in. Add the address, GST and PAN, then save.",
        confirmLabel: "Yes, convert",
        cancelLabel: "Later",
      });
      if (yes) return router.push(`/customers/new?lead=${saved.id}`);
    }
    onSaved(saved);
  };

  const onSubmit = (ev: React.FormEvent<HTMLFormElement>) =>
    handleSubmit(
      (v) =>
        start(async () => {
          const linked = v.existingCustomer && !!v.customerId;
          if (mode === "create") {
            const r = await createLeadAction(v);
            if (!r.ok) return void toast.error(r.message);
            form.reset(v);
            toast.success(`Enquiry ${r.data.leadNo} added`);
            const won = options.stages.find((s) => s.id === v.stageId)?.type === "WON";
            void finish(r.data, won && !linked, v.companyName);
          } else {
            const r = await updateLeadAction(leadId!, v);
            if (!r.ok) return void toast.error(r.message);
            form.reset(v);
            const won = r.data.moved?.changed && r.data.moved.toType === "WON";
            toast.success(won ? `“${v.title}” is won` : r.data.changed ? "Enquiry saved" : "No changes to save");
            void finish({ id: leadId! }, !!won && !r.data.moved?.customerId, v.companyName);
          }
        }),
      () => toast.error("Some details need a second look. Please check the fields marked in red."),
    )(ev);

  const grid = wide ? "grid grid-cols-1 gap-5 md:grid-cols-2" : "grid grid-cols-1 gap-5";
  const span = wide ? "md:col-span-2" : "";

  const customerDup = dups?.customers.find((c) => c.id !== linkedId);
  const leadDups = dups?.leads ?? [];

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      {dialog}
      {fullPageHref ? (
        <div className="flex justify-end">
          <Button asChild variant="ghost" size="sm" onClick={() => saveLeadDraft(getValues(), leadId)}>
            {/* What's typed is carried over, so no "unsaved changes" warning here. */}
            <Link href={fullPageHref} data-skip-unsaved>
              <Expand aria-hidden /> Open full page
            </Link>
          </Button>
        </div>
      ) : null}

      {/* Card 1: Enquiry */}
      <Card title="Enquiry" icon={<ClipboardList className="size-5" />}>
        <div className={grid}>
          <Field label="Enquiry title" required error={e.title?.message} helper="e.g. 3D printing of 20 prototype parts" className={span}>
            {(p) => <Input {...p} {...register("title")} maxLength={200} />}
          </Field>
          <Field label="Source" required error={e.sourceId?.message} helper="Where the enquiry came from">
            {(p) => (
              <Controller
                control={control}
                name="sourceId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={(v) => field.onChange(v)}>
                    <SelectTrigger {...p} className="w-full" onBlur={field.onBlur}>
                      <SelectValue placeholder="Choose source" />
                    </SelectTrigger>
                    <SelectContent>
                      {options.sources.map((s) => (
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
          <Field label="Stage" required error={e.stageId?.message} helper={currentStage?.type === "LOST" ? "To reopen it, choose an open stage." : undefined}>
            {(p) => (
              <Controller
                control={control}
                name="stageId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger {...p} className="w-full">
                      <SelectValue placeholder="Choose stage" />
                    </SelectTrigger>
                    <SelectContent>
                      {stageChoices.map((s) => (
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

          <div className={cn("flex flex-col gap-2", span)}>
            <span className="text-base font-medium">
              Department(s) interested <span className="font-normal text-muted-foreground">(optional)</span>
            </span>
            <div role="group" aria-label="Departments interested" className="flex flex-wrap gap-2">
              {options.departments.map((d) => {
                const on = deptCodes.includes(d.code);
                return (
                  <button
                    key={d.code}
                    type="button"
                    aria-pressed={on}
                    title={d.name}
                    onClick={() => toggleDept(d.code)}
                    className={cn("inline-flex h-10 items-center rounded-full border px-4 text-sm font-medium", on ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-primary/40")}
                  >
                    {d.code} <span className={cn("ml-1.5 hidden font-normal sm:inline", on ? "text-primary-foreground/80" : "text-muted-foreground")}>{d.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className={cn("flex flex-col gap-2", span)}>
            <span className="text-base font-medium">
              Services interested <span className="font-normal text-muted-foreground">(optional)</span>
            </span>
            {!deptCodes.length ? (
              <p className="text-sm text-muted-foreground">Choose a department above to see its services.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {deptCodes.map((code) => {
                  const list = visibleServices.filter((s) => s.deptCode === code);
                  return (
                    <fieldset key={code} className="rounded-xl border p-3">
                      <legend className="px-1 text-sm font-semibold text-primary">{code}</legend>
                      <div className={cn("grid gap-1", wide ? "sm:grid-cols-2" : "sm:grid-cols-2")}>
                        {list.map((s) => {
                          const on = serviceIds.includes(s.id);
                          return (
                            <label key={s.id} className="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-lg px-2 hover:bg-secondary">
                              <input
                                type="checkbox"
                                className="size-4 accent-[var(--primary)]"
                                checked={on}
                                onChange={() =>
                                  setValue(
                                    "serviceIds",
                                    on ? serviceIds.filter((x) => x !== s.id) : [...serviceIds, s.id],
                                    dirty,
                                  )
                                }
                              />
                              <span className="text-sm">{s.name}</span>
                            </label>
                          );
                        })}
                      </div>
                    </fieldset>
                  );
                })}
              </div>
            )}
          </div>

          <Field label="Expected value (₹)" optional error={e.expectedValue?.message} helper="e.g. 50000">
            {(p) => (
              <div className="flex min-w-0 items-center rounded-xl border bg-card focus-within:ring-2 focus-within:ring-ring">
                <span className="pl-3 text-muted-foreground">₹</span>
                <Input {...p} inputMode="decimal" className="border-0 shadow-none focus-visible:ring-0" {...register("expectedValue")} />
              </div>
            )}
          </Field>
          <Field label="Expected close date" optional error={e.expectedCloseDate?.message}>
            {(p) => <Input {...p} type="date" {...register("expectedCloseDate")} />}
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-base font-medium">Priority</span>
            <div className="flex min-h-11 items-center">
              <PriorityStars size="md" value={w.priority ?? 0} onChange={(v) => setValue("priority", v, dirty)} />
            </div>
          </div>
          <Field label="Assigned to" optional>
            {(p) => (
              <Controller
                control={control}
                name="assignedTo"
                render={({ field }) => (
                  <Select value={field.value || "none"} onValueChange={(v) => field.onChange(v === "none" ? "" : v)}>
                    <SelectTrigger {...p} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Not assigned</SelectItem>
                      {options.team.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            )}
          </Field>

          <div className={cn("flex flex-col gap-2", span)}>
            <span className="text-base font-medium">
              Tags <span className="font-normal text-muted-foreground">(optional)</span>
            </span>
            <div role="group" aria-label="Tags" className="flex flex-wrap gap-2">
              {tags.map((t) => {
                const on = tagIds.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setValue("tagIds", on ? tagIds.filter((x) => x !== t.id) : [...tagIds, t.id], dirty)}
                    className={cn("inline-flex h-9 items-center rounded-full border px-3 text-sm font-medium", on ? "border-violet-600 bg-violet-600 text-white" : "bg-card hover:border-violet-300")}
                  >
                    {t.name}
                  </button>
                );
              })}
            </div>
            <div className="flex max-w-sm gap-2">
              <Input
                aria-label="New tag"
                placeholder="Type a new tag"
                value={newTag}
                maxLength={60}
                onChange={(ev) => setNewTag(ev.target.value)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter") {
                    ev.preventDefault();
                    addTag();
                  }
                }}
              />
              <Button type="button" variant="outline" onClick={addTag} disabled={!newTag.trim() || pending}>
                <Plus aria-hidden /> Add
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {/* Card 2: Company and contact */}
      <Card title="Company and contact" icon={<Building2 className="size-5" />}>
        <div className={grid}>
          <div className={cn("flex flex-col gap-2", span)}>
            <label className="flex min-h-11 items-center gap-3">
              <Controller
                control={control}
                name="existingCustomer"
                render={({ field }) => (
                  <Switch
                    checked={field.value}
                    onCheckedChange={(v) => {
                      field.onChange(v);
                      if (!v) setValue("customerId", "", dirty);
                    }}
                    aria-label="Existing customer?"
                  />
                )}
              />
              <span className="text-base font-medium">Existing customer?</span>
            </label>
            {w.existingCustomer ? (
              <Field label="Customer" required error={e.customerId?.message} helper="Fills in the details below. You can still change them for this enquiry.">
                {() => <CustomerPicker customers={options.customers} value={w.customerId || null} onChange={linkCustomer} />}
              </Field>
            ) : null}
          </div>

          {customerDup || leadDups.length ? (
            <div role="status" className={cn("flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900", span)}>
              {customerDup ? (
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <AlertTriangle className="size-4 shrink-0" aria-hidden />
                  <span>
                    A customer with this {customerDup.matchedOn.join(" and ")} already exists: <strong>{customerDup.companyName}</strong>.
                  </span>
                  {options.customers.some((c) => c.id === customerDup.id) ? (
                    <Button type="button" size="xs" variant="outline" className="border-amber-400 bg-white" onClick={() => linkCustomer(customerDup.id)}>
                      Link to it?
                    </Button>
                  ) : null}
                </p>
              ) : null}
              {leadDups.slice(0, 3).map((d) => (
                <p key={d.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <AlertTriangle className="size-4 shrink-0" aria-hidden />
                  <span>
                    An enquiry with this {d.matchedOn.join(" and ")} already exists: <strong>{d.leadNo}</strong>, {d.title} ({d.companyName}).
                  </span>
                  <Link href={`/crm/enquiries/${d.id}`} target="_blank" className="font-medium underline underline-offset-2">
                    Open it
                  </Link>
                </p>
              ))}
              <p className="text-xs">This is only a reminder. You can still save.</p>
            </div>
          ) : null}

          <Field label="Company name" required error={e.companyName?.message} className={span}>
            {(p) => <Input {...p} {...register("companyName")} maxLength={200} />}
          </Field>
          <Field label="Contact person" required error={e.contactName?.message}>
            {(p) => <Input {...p} {...register("contactName")} maxLength={120} />}
          </Field>
          <Field label="Designation" optional error={e.designation?.message} helper="e.g. Purchase Manager">
            {(p) => <Input {...p} {...register("designation")} maxLength={120} />}
          </Field>
          <Field label="Mobile" error={e.phone?.message} helper="10 digits. Mobile or email is required.">
            {(p) => (
              <div className="flex min-w-0 items-center rounded-xl border bg-card focus-within:ring-2 focus-within:ring-ring">
                <span className="pl-3 text-muted-foreground">+91</span>
                <Input {...p} type="tel" inputMode="numeric" className="border-0 shadow-none focus-visible:ring-0" {...register("phone")} maxLength={16} />
              </div>
            )}
          </Field>
          <Field label="Email" error={e.email?.message} helper="e.g. name@company.com">
            {(p) => <Input {...p} type="email" {...register("email")} maxLength={200} />}
          </Field>
          <Field label="City" optional error={e.city?.message}>
            {(p) => <Input {...p} {...register("city")} maxLength={80} />}
          </Field>
          <Field label="Company category" optional helper="Used when making them a customer">
            {(p) => (
              <Controller
                control={control}
                name="category"
                render={({ field }) => (
                  <Select value={field.value || "none"} onValueChange={(v) => field.onChange(v === "none" ? "" : v)}>
                    <SelectTrigger {...p} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Not known yet</SelectItem>
                      {CATS.map((c) => (
                        <SelectItem key={c} value={c}>
                          {CATEGORY_LABELS[c]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            )}
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-base font-medium">
              MCCIA member? <span className="font-normal text-muted-foreground">(optional)</span>
            </span>
            <div role="group" aria-label="MCCIA member?" className="flex gap-2">
              {(["yes", "no"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={w.isMcciaMember === v}
                  onClick={() => setValue("isMcciaMember", w.isMcciaMember === v ? "" : v, dirty)}
                  className={cn("inline-flex h-11 min-w-20 items-center justify-center rounded-xl border px-4 font-medium", w.isMcciaMember === v ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-primary/40")}
                >
                  {v === "yes" ? "Yes" : "No"}
                </button>
              ))}
            </div>
          </div>
          {w.isMcciaMember === "yes" ? (
            <Field label="Membership ID" optional error={e.mcciaMembershipId?.message}>
              {(p) => <Input {...p} {...register("mcciaMembershipId")} maxLength={60} />}
            </Field>
          ) : null}
        </div>
      </Card>

      {/* Card 3: Notes */}
      <Card title="Notes" icon={<NotebookPen className="size-5" />}>
        <Field label="Details of the enquiry" optional helper="e.g. Needs parts in ABS-like resin, drawings to follow by email">
          {(p) => <Textarea {...p} rows={5} {...register("notes")} maxLength={5000} />}
        </Field>
      </Card>

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-end gap-2 border-t bg-card/95 px-1 py-3 backdrop-blur">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
          {mode === "create" ? "Save enquiry" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border bg-card p-4 sm:p-5">
      <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-primary">
        <span className="grid size-9 place-items-center rounded-lg bg-secondary">{icon}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}
