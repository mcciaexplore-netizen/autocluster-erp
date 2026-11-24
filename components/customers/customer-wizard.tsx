"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Building2,
  Check,
  CheckCircle2,
  FilePlus2,
  Info,
  Loader2,
  RotateCcw,
  UserRound, Handshake } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { saveCustomerDetails, saveCustomerLinks } from "@/lib/actions/customers";
import { linkLeadToCustomerAction } from "@/lib/actions/crm";
import { DeptIcon } from "@/components/customers/dept-icons";
import { Field, FormSection, StepProgress } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Department, Service } from "@/db/schema";
import { clearDraft, readDraft, writeDraft } from "@/hooks/use-local-draft";
import { useUnsavedChangesWarning } from "@/hooks/use-unsaved-changes";
import { INDIAN_STATES, parseGstin, PAN_REGEX, stateByCode } from "@/lib/india";
import {
  customerRate,
  formatINRShort,
  priceTypeFor,
  UNIT_LABELS,
  type PricingSettings,
} from "@/lib/pricing";
import { cn } from "@/lib/utils";
import {
  customerDetailsSchema,
  EMPTY_CUSTOMER_DETAILS,
  type CustomerDetailsInput,
} from "@/lib/validation/customer";

type Step = 1 | 2 | 3 | "done";
const STEP_LABELS = { 1: "Company details", 2: "Department", 3: "Services" } as const;

interface DraftState {
  step: Step;
  customerId: string | null;
  details: CustomerDetailsInput;
  deptCodes: string[];
  serviceIds: number[];
}

export interface CustomerWizardProps {
  departments: Department[];
  /** Rates may be hidden (null) for people who can't see prices; the form doesn't use them. */
  services: (Omit<Service, "rateMsme" | "rateOem"> & { rateMsme: string | null; rateOem: string | null })[];
  pricing: PricingSettings;
  /** Pre-filled credit period for new customers (Settings > default credit period). */
  defaultCreditDays?: number;
  /** Present when editing an existing customer. */
  initial?: {
    id: string;
    details: CustomerDetailsInput;
    deptCodes: string[];
    serviceIds: number[];
  };
  /**
   * When the wizard is shown inside another screen (e.g. the quotation builder's side panel),
   * this is called after saving instead of showing the success screen.
   */
  onSaved?: (customer: { id: string; companyName: string }) => void;
  onCancel?: () => void;
  /** "Convert to customer" from a CRM enquiry: details filled in from it, and linked to it after saving. */
  fromLead?: {
    id: string;
    leadNo: string;
    title: string;
    /** "quote": go on to the quotation builder after saving. */
    next: "quote" | null;
    details: Partial<CustomerDetailsInput>;
    deptCodes: string[];
    serviceIds: number[];
  };
}

const CATEGORY_OPTIONS = [
  { value: "OEM", title: "OEM", hint: "Vehicle maker" },
  { value: "TIER1", title: "Tier 1", hint: "Supplies OEMs directly" },
  { value: "TIER2", title: "Tier 2", hint: "Supplies Tier 1 companies" },
  { value: "MSME", title: "MSME", hint: "Micro, small or medium business" },
] as const;

export function CustomerWizard({ departments, services, pricing, initial, onSaved, onCancel, defaultCreditDays = 30, fromLead }: CustomerWizardProps) {
  const blank: CustomerDetailsInput = { ...EMPTY_CUSTOMER_DETAILS, creditDays: String(defaultCreditDays), ...fromLead?.details };
  const router = useRouter();
  const editing = !!initial;
  const embedded = !!onSaved;
  const storageKey = editing
    ? `acdri:customer-wizard:${initial.id}`
    : fromLead
      ? `acdri:customer-wizard:new:lead:${fromLead.id}`
      : `acdri:customer-wizard:new${embedded ? ":panel" : ""}`;

  const [step, setStep] = useState<Step>(1);
  const [customerId, setCustomerId] = useState<string | null>(initial?.id ?? null);
  const [deptCodes, setDeptCodes] = useState<string[]>(initial?.deptCodes ?? fromLead?.deptCodes ?? []);
  const [serviceIds, setServiceIds] = useState<number[]>(initial?.serviceIds ?? fromLead?.serviceIds ?? []);
  const [deptError, setDeptError] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedName, setSavedName] = useState<string>("");
  const [pending, startTransition] = useTransition();
  const lastAutoPan = useRef<string | null>(null);
  const topRef = useRef<HTMLDivElement>(null);

  const form = useForm<CustomerDetailsInput>({
    resolver: zodResolver(customerDetailsSchema),
    defaultValues: initial?.details ?? blank,
    mode: "onTouched",
  });
  const { register, control, setValue, getValues, formState, handleSubmit, reset, setError } = form;
  const errors = formState.errors;
  const values = useWatch({ control });

  // ---- Restore an unfinished form from this browser -----------------------
  // Browser storage only exists after the page loads, so this has to run in an effect.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const d = readDraft<DraftState>(storageKey);
    if (d && d.step !== "done") {
      reset({ ...blank, ...d.details });
      setStep(d.step);
      setCustomerId(d.customerId ?? initial?.id ?? null);
      setDeptCodes(d.deptCodes);
      setServiceIds(d.serviceIds);
      setRestored(true);
      setDirty(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const isDirty = dirty || formState.isDirty;

  // ---- Autosave while typing ------------------------------------------------
  useEffect(() => {
    if (!isDirty || step === "done") return;
    const t = setTimeout(() => {
      writeDraft<DraftState>(storageKey, {
        step,
        customerId,
        details: getValues(),
        deptCodes,
        serviceIds,
      });
    }, 400);
    return () => clearTimeout(t);
  }, [values, step, customerId, deptCodes, serviceIds, isDirty, storageKey, getValues]);

  useUnsavedChangesWarning(isDirty && step !== "done");

  const startOver = () => {
    clearDraft(storageKey);
    reset(initial?.details ?? blank);
    setStep(1);
    setCustomerId(initial?.id ?? null);
    setDeptCodes(initial?.deptCodes ?? fromLead?.deptCodes ?? []);
    setServiceIds(initial?.serviceIds ?? fromLead?.serviceIds ?? []);
    setRestored(false);
    setDirty(false);
  };

  const goTo = (s: Step) => {
    setStep(s);
    requestAnimationFrame(() => topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  // ---- Live price type -----------------------------------------------------
  const category = values.category;
  const isMember = values.isMcciaMember === "yes";
  const priceType = useMemo(
    () => (category ? priceTypeFor({ category, isMcciaMember: isMember }, pricing) : null),
    [category, isMember, pricing],
  );

  // ---- GST helpers -----------------------------------------------------------
  const gstin = values.gstin ?? "";
  const pan = values.pan ?? "";
  const gstPan = gstin.length >= 12 ? gstin.slice(2, 12) : null;
  const panWarning =
    !values.notGstRegistered && gstPan && PAN_REGEX.test(gstPan) && PAN_REGEX.test(pan) && pan !== gstPan
      ? `This PAN does not match the PAN inside the GST number (${gstPan}). Please check it.`
      : null;
  const stateFromGst = !values.notGstRegistered && gstin.length >= 2 && !!stateByCode(gstin.slice(0, 2));

  const onGstinChange = (raw: string) => {
    const v = raw.toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 15);
    setValue("gstin", v, { shouldDirty: true, shouldValidate: !!formState.touchedFields.gstin });
    const p = parseGstin(v);
    if (p.state) setValue("stateCode", p.state.code, { shouldDirty: true, shouldValidate: true });
    const currentPan = getValues("pan");
    if (p.pan && (!currentPan || currentPan === lastAutoPan.current)) {
      setValue("pan", p.pan, { shouldDirty: true, shouldValidate: true });
      lastAutoPan.current = p.pan;
    }
  };

  const upper = (name: "pan" | "tan" | "udyamNo" | "mcciaMembershipId", max?: number) =>
    register(name, {
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
        let v = e.target.value.toUpperCase();
        if (name === "pan" || name === "tan") v = v.replace(/[^0-9A-Z]/g, "");
        if (max) v = v.slice(0, max);
        if (v !== e.target.value) setValue(name, v, { shouldDirty: true });
      },
    });

  // ---- Step 1: save details (creates a draft customer) ----------------------
  const submitDetails = (e: React.FormEvent<HTMLFormElement>) =>
    handleSubmit(
    (data) => {
      startTransition(async () => {
        const res = await saveCustomerDetails(data, customerId);
        if (!res.ok) {
          if (res.fieldErrors) {
            for (const [k, m] of Object.entries(res.fieldErrors)) setError(k as keyof CustomerDetailsInput, { message: m });
          }
          toast.error(res.message);
          return;
        }
        setCustomerId(res.data.id);
        toast.success(editing ? "Company details saved" : "Company details saved as a draft");
        goTo(2);
      });
    },
    () => {
      toast.error("Some details need a second look. Please check the fields marked in red.");
      // Move focus to the first field with a problem.
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>("[aria-invalid='true']");
        el?.focus();
      });
    },
  )(e);

  // ---- Step 2 ------------------------------------------------------------------
  const toggleDept = (code: string) => {
    setDirty(true);
    setDeptError(null);
    setDeptCodes((cur) => (cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code]));
  };
  const continueToServices = () => {
    if (!deptCodes.length) {
      setDeptError("Please choose at least one department.");
      return;
    }
    // Drop services from departments that were un-ticked.
    const allowed = new Set(services.filter((s) => deptCodes.includes(s.deptCode)).map((s) => s.id));
    setServiceIds((cur) => cur.filter((id) => allowed.has(id)));
    goTo(3);
  };

  // ---- Step 3 ------------------------------------------------------------------
  const toggleService = (id: number) => {
    setDirty(true);
    setServiceIds((cur) => (cur.includes(id) ? cur.filter((s) => s !== id) : [...cur, id]));
  };

  const saveAll = () => {
    if (!customerId) {
      goTo(1);
      return;
    }
    startTransition(async () => {
      const res = await saveCustomerLinks(customerId, { deptCodes, serviceIds });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      clearDraft(storageKey);
      setDirty(false);
      toast.success("Customer saved");
      if (fromLead) {
        const link = await linkLeadToCustomerAction(fromLead.id, res.data.id);
        if (!link.ok) toast.error(`The customer was saved, but linking the enquiry failed: ${link.message}`);
        else toast.success(`Enquiry ${fromLead.leadNo} linked to ${res.data.companyName}`);
        if (fromLead.next === "quote") {
          router.push(`/quotations/new?customer=${res.data.id}&lead=${fromLead.id}`);
          return;
        }
      }
      if (onSaved) {
        onSaved(res.data);
        return;
      }
      if (editing) {
        router.push(`/customers/${res.data.id}`);
        router.refresh();
        return;
      }
      setSavedName(res.data.companyName);
      goTo("done");
    });
  };

  // ---- Render -----------------------------------------------------------------
  if (step === "done") {
    return (
      <div ref={topRef} className="mx-auto max-w-xl py-10 text-center">
        <span className="mx-auto mb-5 grid size-20 place-items-center rounded-full bg-success/10 text-success">
          <CheckCircle2 className="size-12" aria-hidden />
        </span>
        <h1 className="font-title text-3xl text-primary md:text-4xl">{savedName} saved</h1>
        <p className="mt-2 text-muted-foreground">The customer is ready. What would you like to do next?</p>
        <div className="mt-8 flex flex-col gap-3">
          <Button asChild size="lg">
            <Link href={`/quotations/new?customer=${customerId}${fromLead ? `&lead=${fromLead.id}` : ""}`}>
              <FilePlus2 aria-hidden /> Create a quotation for this customer
            </Link>
          </Button>
          {fromLead ? (
            <Button asChild size="lg" variant="outline">
              <Link href={`/crm/enquiries/${fromLead.id}`}>Back to the enquiry</Link>
            </Button>
          ) : null}
          <Button asChild size="lg" variant="outline">
            <Link href="/customers">Back to customers</Link>
          </Button>
        </div>
      </div>
    );
  }

  const stepNum = step;
  const visibleServices = (dept: string) =>
    services.filter((s) => s.deptCode === dept && (s.isActive || serviceIds.includes(s.id)));

  return (
    <div ref={topRef} className="scroll-mt-24">
      <StepProgress step={stepNum} total={3} label={STEP_LABELS[stepNum]} />

      {fromLead ? (
        <div className="mb-6 flex gap-3 rounded-xl border border-violet-200 bg-violet-50 p-4 text-violet-950">
          <Handshake className="mt-0.5 size-5 shrink-0" aria-hidden />
          <div>
            <p className="font-medium">
              From enquiry {fromLead.leadNo}: {fromLead.title}
            </p>
            <p className="text-sm">
              {fromLead.next === "quote" ? "A quotation needs the customer's GST and address. Let's add them first. " : ""}
              The enquiry&apos;s details are filled in. Add the address, GST and PAN, then save.
            </p>
          </div>
        </div>
      ) : null}

      {restored ? (
        <div className="mb-6 flex flex-col gap-3 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sky-900 sm:flex-row sm:items-center">
          <Info className="size-5 shrink-0" aria-hidden />
          <p className="flex-1">We brought back the form you had not finished, so nothing is lost.</p>
          <Button variant="outline" size="sm" onClick={startOver}>
            <RotateCcw aria-hidden /> Start over
          </Button>
        </div>
      ) : null}

      {/* ------------------------------------------------------------ STEP 1 */}
      {step === 1 ? (
        <form onSubmit={submitDetails} noValidate className="flex flex-col gap-6">
          <FormSection title="Company" icon={<Building2 className="size-5" />}>
            <div className="grid gap-5 md:grid-cols-2">
              <Field label="Company name" required error={errors.companyName?.message} helper="e.g. Sahyadri Auto Components Pvt Ltd" className="md:col-span-2">
                {(p) => <Input {...p} autoComplete="organization" {...register("companyName")} />}
              </Field>

              <fieldset className="md:col-span-2" aria-describedby="category-help category-err">
                <legend className="mb-1.5 text-base font-medium">
                  Company category<span className="text-destructive" aria-hidden> *</span>
                </legend>
                <p id="category-help" className="mb-3 text-sm text-muted-foreground">This decides which rate applies.</p>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  {CATEGORY_OPTIONS.map((o) => (
                    <label
                      key={o.value}
                      className={cn(
                        "relative flex min-h-20 cursor-pointer flex-col justify-center rounded-xl border-2 bg-card px-4 py-3 transition",
                        "hover:border-primary/40 has-[:checked]:border-primary has-[:checked]:bg-secondary has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring",
                        errors.category && "border-destructive/60",
                      )}
                    >
                      <input type="radio" value={o.value} className="peer sr-only" {...register("category")} />
                      <span className="text-lg font-semibold text-primary">{o.title}</span>
                      <span className="text-sm text-muted-foreground">{o.hint}</span>
                      <Check className="absolute top-3 right-3 hidden size-5 text-primary peer-checked:block" aria-hidden />
                    </label>
                  ))}
                </div>
                <p id="category-err" className="mt-1.5 text-sm font-medium text-destructive" aria-live="polite">
                  {errors.category?.message}
                </p>
              </fieldset>

              {category === "MSME" ? (
                <Field label="Udyam registration no." optional helper="e.g. UDYAM-MH-26-0012345" className="md:col-span-2">
                  {(p) => <Input {...p} {...upper("udyamNo", 25)} />}
                </Field>
              ) : null}

              <Field label="Address line 1" required error={errors.addressLine1?.message} helper="Building, plot or street, e.g. Plot 42, MIDC Bhosari">
                {(p) => <Input {...p} autoComplete="address-line1" {...register("addressLine1")} />}
              </Field>
              <Field label="Address line 2" optional helper="Area or landmark">
                {(p) => <Input {...p} autoComplete="address-line2" {...register("addressLine2")} />}
              </Field>
              <Field label="City" required error={errors.city?.message} helper="e.g. Pune">
                {(p) => <Input {...p} autoComplete="address-level2" {...register("city")} />}
              </Field>
              <Field label="Pincode" required error={errors.pincode?.message} helper="6 digits, e.g. 411018">
                {(p) => (
                  <Input
                    {...p}
                    inputMode="numeric"
                    autoComplete="postal-code"
                    maxLength={6}
                    {...register("pincode", {
                      onChange: (e) => setValue("pincode", e.target.value.replace(/\D/g, "").slice(0, 6)),
                    })}
                  />
                )}
              </Field>

              <div className="flex flex-col gap-3 md:col-span-2">
                <Field
                  label="GST number (GSTIN)"
                  required={!values.notGstRegistered}
                  error={values.notGstRegistered ? undefined : errors.gstin?.message}
                  helper="15 characters, e.g. 27AABCU9603R1ZM. We fill in the State and PAN for you."
                >
                  {(p) => (
                    <Input
                      {...p}
                      disabled={values.notGstRegistered}
                      className="font-mono tracking-wider uppercase"
                      maxLength={15}
                      autoCapitalize="characters"
                      spellCheck={false}
                      {...register("gstin", { onChange: (e) => onGstinChange(e.target.value) })}
                    />
                  )}
                </Field>
                <label className="flex min-h-11 w-fit cursor-pointer items-center gap-3 text-base">
                  <Controller
                    control={control}
                    name="notGstRegistered"
                    render={({ field }) => (
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={(c) => {
                          field.onChange(c === true);
                          if (c === true) form.clearErrors("gstin");
                        }}
                      />
                    )}
                  />
                  Not registered under GST
                </label>
              </div>

              <Field
                label="State"
                required
                error={errors.stateCode?.message}
                helper={stateFromGst ? "Filled in from the GST number." : "Choose the state of this address."}
              >
                {(p) => (
                  <Controller
                    control={control}
                    name="stateCode"
                    render={({ field }) => (
                      <Select value={field.value || undefined} onValueChange={(v) => { field.onChange(v); field.onBlur(); }}>
                        <SelectTrigger {...p} className="w-full" onBlur={field.onBlur}>
                          <SelectValue placeholder="Choose a state" />
                        </SelectTrigger>
                        <SelectContent className="max-h-80">
                          {INDIAN_STATES.map((s) => (
                            <SelectItem key={s.code} value={s.code}>
                              {s.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                )}
              </Field>
              <Field label="PAN" required error={errors.pan?.message} warning={panWarning} helper="10 characters, e.g. AABCU9603R">
                {(p) => <Input {...p} className="font-mono tracking-wider uppercase" maxLength={10} spellCheck={false} {...upper("pan", 10)} />}
              </Field>
              <Field label="TAN" optional error={errors.tan?.message} helper="10 characters, e.g. PNEA12345B">
                {(p) => <Input {...p} className="font-mono tracking-wider uppercase" maxLength={10} spellCheck={false} {...upper("tan", 10)} />}
              </Field>
              <Field label="Credit period (days)" required error={errors.creditDays?.message} helper="Days the customer gets to pay an invoice, e.g. 30">
                {(p) => (
                  <Input
                    {...p}
                    inputMode="numeric"
                    maxLength={3}
                    {...register("creditDays", { onChange: (e) => setValue("creditDays", e.target.value.replace(/\D/g, "").slice(0, 3)) })}
                  />
                )}
              </Field>
            </div>
          </FormSection>

          <FormSection title="Contact person" icon={<UserRound className="size-5" />}>
            <div className="grid gap-5 md:grid-cols-2">
              <Field label="Name" required error={errors.pocName?.message} helper="e.g. Rohan Kulkarni">
                {(p) => <Input {...p} autoComplete="name" {...register("pocName")} />}
              </Field>
              <Field label="Designation" optional helper="e.g. Purchase Manager">
                {(p) => <Input {...p} autoComplete="organization-title" {...register("pocDesignation")} />}
              </Field>
              <Field label="Mobile number" required error={errors.pocPhone?.message} helper="10 digits, e.g. 9822012345">
                {(p) => (
                  <div className="flex">
                    <span className="flex h-11 items-center rounded-l-xl border border-r-0 border-input bg-secondary px-3.5 font-medium text-primary">
                      +91
                    </span>
                    <Input
                      {...p}
                      type="tel"
                      inputMode="numeric"
                      autoComplete="tel-national"
                      maxLength={10}
                      className="rounded-l-none"
                      {...register("pocPhone", {
                        onChange: (e) => setValue("pocPhone", e.target.value.replace(/\D/g, "").slice(0, 10)),
                      })}
                    />
                  </div>
                )}
              </Field>
              <Field label="Email" required error={errors.pocEmail?.message} helper="e.g. name@company.com">
                {(p) => <Input {...p} type="email" autoComplete="email" {...register("pocEmail")} />}
              </Field>
            </div>
          </FormSection>

          <FormSection title="MCCIA membership" icon={<BadgeCheck className="size-5" />}>
            <fieldset aria-describedby="member-err">
              <legend className="mb-3 text-base font-medium">
                Is this company a member of MCCIA?<span className="text-destructive" aria-hidden> *</span>
              </legend>
              <div className="grid max-w-md grid-cols-2 gap-3">
                {(["yes", "no"] as const).map((v) => (
                  <label
                    key={v}
                    className={cn(
                      "flex h-14 cursor-pointer items-center justify-center gap-2 rounded-xl border-2 bg-card text-lg font-semibold text-primary transition",
                      "hover:border-primary/40 has-[:checked]:border-primary has-[:checked]:bg-secondary has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring",
                      errors.isMcciaMember && "border-destructive/60",
                    )}
                  >
                    <input
                      type="radio"
                      value={v}
                      className="sr-only"
                      {...register("isMcciaMember", {
                        onChange: () => {
                          if (v === "no") form.clearErrors("mcciaMembershipId");
                        },
                      })}
                    />
                    {v === "yes" ? "Yes" : "No"}
                  </label>
                ))}
              </div>
              <p id="member-err" className="mt-1.5 text-sm font-medium text-destructive" aria-live="polite">
                {errors.isMcciaMember?.message}
              </p>
            </fieldset>

            <div
              className={cn(
                "grid transition-all duration-300 ease-out",
                isMember ? "mt-4 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
              )}
              aria-hidden={!isMember}
            >
              <div className="overflow-hidden">
                {isMember ? (
                  <Field
                    label="MCCIA Membership ID"
                    required
                    error={errors.mcciaMembershipId?.message}
                    helper={`e.g. MCCIA/2019/04512. Members get ${pricing.memberDiscountPct}% off.`}
                    className="max-w-md p-1"
                  >
                    {(p) => <Input {...p} {...upper("mcciaMembershipId", 40)} />}
                  </Field>
                ) : null}
              </div>
            </div>
          </FormSection>

          {priceType ? (
            <p className="flex items-center gap-2 rounded-xl bg-secondary px-4 py-3 text-primary">
              <Info className="size-5 shrink-0" aria-hidden />
              <span>
                Price type for this customer: <strong>{priceType.badge}</strong>
              </span>
            </p>
          ) : null}

          <WizardButtons>
            {onCancel ? (
              <Button type="button" variant="outline" size="lg" onClick={onCancel}>
                Cancel
              </Button>
            ) : editing ? (
              <Button asChild variant="outline" size="lg">
                <Link href={`/customers/${initial.id}`}>Cancel</Link>
              </Button>
            ) : (
              <span />
            )}
            <Button type="submit" size="lg" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Save and continue <ArrowRight aria-hidden />
            </Button>
          </WizardButtons>
        </form>
      ) : null}

      {/* ------------------------------------------------------------ STEP 2 */}
      {step === 2 ? (
        <div className="flex flex-col gap-6">
          <fieldset>
            <legend className="mb-1 text-2xl font-semibold text-primary">Which department(s) will this customer work with?</legend>
            <p className="mb-5 text-muted-foreground">You can choose more than one.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              {departments.map((d) => {
                const checked = deptCodes.includes(d.code);
                return (
                  <label
                    key={d.code}
                    className={cn(
                      "relative flex cursor-pointer gap-4 rounded-2xl border-2 bg-card p-5 transition",
                      "hover:border-primary/40 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring",
                      checked && "border-primary bg-secondary",
                    )}
                  >
                    <input type="checkbox" className="sr-only" checked={checked} onChange={() => toggleDept(d.code)} />
                    <span className={cn("grid size-12 shrink-0 place-items-center rounded-xl", checked ? "bg-primary text-primary-foreground" : "bg-secondary text-primary")}>
                      <DeptIcon code={d.code} className="size-6" />
                    </span>
                    <span className="min-w-0 flex-1 pr-6">
                      <span className="block text-lg font-semibold text-primary">
                        {d.code} - {d.name}
                      </span>
                      <span className="block text-sm text-muted-foreground">{d.description}</span>
                    </span>
                    <span
                      className={cn(
                        "absolute top-4 right-4 grid size-6 place-items-center rounded-md border-2",
                        checked ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card",
                      )}
                      aria-hidden
                    >
                      {checked ? <Check className="size-4" /> : null}
                    </span>
                  </label>
                );
              })}
            </div>
            <p className="mt-3 text-sm font-medium text-destructive" aria-live="polite">
              {deptError}
            </p>
          </fieldset>
          <WizardButtons>
            <Button type="button" variant="outline" size="lg" onClick={() => goTo(1)}>
              <ArrowLeft aria-hidden /> Back
            </Button>
            <Button type="button" size="lg" onClick={continueToServices}>
              Continue <ArrowRight aria-hidden />
            </Button>
          </WizardButtons>
        </div>
      ) : null}

      {/* ------------------------------------------------------------ STEP 3 */}
      {step === 3 && priceType ? (
        <div className="flex flex-col gap-6">
          <div>
            <h2 className="text-2xl font-semibold text-primary">Which services does this customer need?</h2>
            <p className="text-muted-foreground">Tick the services they usually use. These show first when you make a quotation. You can skip this.</p>
          </div>

          <div className="sticky top-[4.5rem] z-10 flex items-center gap-2 rounded-xl bg-primary px-4 py-3 text-primary-foreground shadow-md">
            <Info className="size-5 shrink-0" aria-hidden />
            <span>
              Price type for this customer: <strong>{priceType.badge}</strong>
            </span>
          </div>

          {deptCodes
            .map((c) => departments.find((d) => d.code === c)!)
            .filter(Boolean)
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((d) => {
              const list = visibleServices(d.code);
              const allOn = list.length > 0 && list.every((s) => serviceIds.includes(s.id));
              return (
                <section key={d.code} aria-labelledby={`dept-${d.code}`}>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h3 id={`dept-${d.code}`} className="flex items-center gap-2 text-lg font-semibold">
                      <DeptIcon code={d.code} className="size-5" /> {d.code} - {d.name}
                    </h3>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setDirty(true);
                        const ids = list.map((s) => s.id);
                        setServiceIds((cur) => (allOn ? cur.filter((x) => !ids.includes(x)) : [...new Set([...cur, ...ids])]));
                      }}
                    >
                      {allOn ? "Clear all" : "Choose all"}
                    </Button>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    {list.map((s) => {
                      const checked = serviceIds.includes(s.id);
                      // Rates are hidden (null) for people who may not see prices.
                      const r = s.rateMsme == null || s.rateOem == null ? null : customerRate({ ...s, rateMsme: s.rateMsme, rateOem: s.rateOem }, priceType);
                      const discounted = !!r && r.finalRatePaise !== r.listRatePaise;
                      return (
                        <label
                          key={s.id}
                          className={cn(
                            "flex cursor-pointer gap-3 rounded-xl border-2 bg-card p-4 transition",
                            "hover:border-primary/40 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring",
                            checked && "border-primary bg-secondary",
                          )}
                        >
                          <input type="checkbox" className="sr-only" checked={checked} onChange={() => toggleService(s.id)} />
                          <span
                            className={cn(
                              "mt-0.5 grid size-6 shrink-0 place-items-center rounded-md border-2",
                              checked ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card",
                            )}
                            aria-hidden
                          >
                            {checked ? <Check className="size-4" /> : null}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block font-semibold text-primary">{s.name}</span>
                            <span className="block text-sm text-muted-foreground">Charged {UNIT_LABELS[s.unitType]}</span>
                            {r ? (
                              <>
                                <span className="mt-1.5 block">
                                  Their price:{" "}
                                  {discounted ? (
                                    <s className="mr-1 text-muted-foreground" aria-label={`List rate ${formatINRShort(r.listRatePaise)}`}>
                                      {formatINRShort(r.listRatePaise)}
                                    </s>
                                  ) : null}
                                  <strong className="text-success">
                                    {formatINRShort(r.finalRatePaise)} {s.unitLabel}
                                  </strong>
                                </span>
                                <span className="block text-sm text-muted-foreground">({priceType.label})</span>
                              </>
                            ) : null}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </section>
              );
            })}

          <WizardButtons>
            <Button type="button" variant="outline" size="lg" onClick={() => goTo(2)}>
              <ArrowLeft aria-hidden /> Back
            </Button>
            <Button type="button" size="lg" onClick={saveAll} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
              Save customer
            </Button>
          </WizardButtons>
        </div>
      ) : null}
    </div>
  );
}

function WizardButtons({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col-reverse gap-3 border-t pt-6 sm:flex-row sm:justify-between">{children}</div>;
}
