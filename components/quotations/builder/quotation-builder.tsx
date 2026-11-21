"use client";

import { ArrowLeft, ArrowRight, Download, FileText, Info, Loader2, Pencil, Plus, Printer, RotateCcw, Save, Trash2, UserPlus, Zap, Handshake, PackageCheck, AlertTriangle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { saveQuotation } from "@/lib/actions/quotations";
import { CategoryBadge, CustomRateTag, MemberBadge } from "@/components/common/badges";
import { CustomerWizard } from "@/components/customers/customer-wizard";
import { DeptIcon } from "@/components/customers/dept-icons";
import { Field, StepProgress } from "@/components/forms/field";
import { QuotationPaper } from "@/components/quotations/quotation-paper";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import type { CustomerSnapshot, Department, Service, Settings } from "@/db/schema";
import { clearDraft, readDraft, writeDraft } from "@/hooks/use-local-draft";
import { useUnsavedChangesWarning } from "@/hooks/use-unsaved-changes";
import { addDaysIso, formatDate, todayIso } from "@/lib/format";
import { customerRate, formatINR, formatINRShort, priceTypeFor } from "@/lib/pricing";
import { priceQuotation, type DraftLine, type ServiceForPricing } from "@/lib/quote-calc";
import { viewFromLive } from "@/lib/quote-view";
import { toPricingSettings } from "@/lib/settings-shared";
import { cn } from "@/lib/utils";
import { stockHint, suggestMaterials, type Material } from "@/lib/inventory/materials";
import { SlotHint } from "@/components/planning/slot-hint";
import { CustomerPicker } from "./customer-picker";
import { ChangeRateDialog, CustomItemDialog } from "./line-dialogs";
import { LiveSummaryBar, LiveSummaryCard } from "./live-summary";
import { ServicePanel } from "./service-panel";

export interface BuilderCustomer extends CustomerSnapshot {
  deptCodes: string[];
  serviceIds: number[];
  tan: string | null;
  udyamNo: string | null;
}

export interface ExistingQuotation {
  id: string;
  quoteNo: string;
  status: "DRAFT" | "SENT" | "ACCEPTED" | "REJECTED";
  customerId: string;
  quoteDate: string;
  validUntil: string;
  subject: string;
  notes: string | null;
  terms: string;
  lines: DraftLine[];
}

type Step = 1 | 2 | 3 | 4;
const STEP_LABELS: Record<Step, string> = {
  1: "Choose customer",
  2: "Add services",
  3: "Quotation details",
  4: "Preview and save",
};

interface Draft {
  step: Step;
  customerId: string | null;
  lines: DraftLine[];
  quoteDate: string;
  validUntil: string;
  subject: string;
  subjectTouched: boolean;
  notes: string;
  terms: string;
}

export function QuotationBuilder({
  customers,
  departments,
  services,
  settings,
  initialCustomerId,
  existing,
  nextQuoteNo,
  fromLead = null,
  materials = {},
}: {
  customers: BuilderCustomer[];
  departments: Department[];
  services: Service[];
  settings: Settings;
  initialCustomerId: string | null;
  existing: ExistingQuotation | null;
  /** Number the next new quotation will most likely get (shown as a preview only). */
  nextQuoteNo: string;
  /** "Create quotation" from a CRM enquiry: its services join the quick-add chips, and lead_id is saved. */
  fromLead?: { id: string; leadNo: string; title: string; serviceIds: number[] } | null;
  /** Inventory: each service's materials list with current stock (for the stock hint under each line). */
  materials?: Record<number, Material[]>;
}) {
  const router = useRouter();
  const pricing = useMemo(() => toPricingSettings(settings), [settings]);
  const storageKey = existing ? `acdri:quote-builder:${existing.id}` : fromLead ? `acdri:quote-builder:new:lead:${fromLead.id}` : "acdri:quote-builder:new";
  const today = todayIso();

  const [step, setStep] = useState<Step>(existing ? 2 : initialCustomerId ? 2 : 1);
  const [customerId, setCustomerId] = useState<string | null>(existing?.customerId ?? initialCustomerId);
  const [lines, setLines] = useState<DraftLine[]>(existing?.lines ?? []);
  const [quoteDate, setQuoteDate] = useState(existing?.quoteDate ?? today);
  const [validUntil, setValidUntil] = useState(existing?.validUntil ?? addDaysIso(today, settings.quoteValidityDays));
  const [subject, setSubject] = useState(existing?.subject ?? "");
  const [subjectTouched, setSubjectTouched] = useState(!!existing);
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [terms, setTerms] = useState(existing?.terms ?? settings.defaultTerms);
  const [dirty, setDirty] = useState(false);
  const [restored, setRestored] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);

  const [panel, setPanel] = useState<{ open: boolean; editKey: string | null; startServiceId: number | null }>({
    open: false,
    editKey: null,
    startServiceId: null,
  });
  const [custom, setCustom] = useState<{ open: boolean; editKey: string | null }>({ open: false, editKey: null });
  const [rateKey, setRateKey] = useState<string | null>(null);
  const [addCustomerOpen, setAddCustomerOpen] = useState(false);
  const [saving, startSaving] = useTransition();
  const topRef = useRef<HTMLDivElement>(null);

  const touch = () => setDirty(true);

  // ---- Restore unfinished work ------------------------------------------------
  // Browser storage only exists after the page loads, so this has to run in an effect.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const d = readDraft<Draft>(storageKey);
    if (!d) return;
    // A link like /quotations/new?customer=X starts fresh for that customer, unless the draft is for the same one.
    if (!existing && initialCustomerId && d.customerId !== initialCustomerId) return;
    setStep(d.step);
    setCustomerId(d.customerId);
    setLines(d.lines);
    setQuoteDate(d.quoteDate);
    setValidUntil(d.validUntil);
    setSubject(d.subject);
    setSubjectTouched(d.subjectTouched);
    setNotes(d.notes);
    setTerms(d.terms);
    setRestored(true);
    setDirty(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // ---- Autosave -------------------------------------------------------------------
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(
      () => writeDraft<Draft>(storageKey, { step, customerId, lines, quoteDate, validUntil, subject, subjectTouched, notes, terms }),
      400,
    );
    return () => clearTimeout(t);
  }, [dirty, storageKey, step, customerId, lines, quoteDate, validUntil, subject, subjectTouched, notes, terms]);

  useUnsavedChangesWarning(dirty);

  // ---- Derived ----------------------------------------------------------------------
  const customer = customers.find((c) => c.id === customerId) ?? null;
  const priceType = customer ? priceTypeFor(customer, pricing) : null;
  const servicesById = useMemo(
    () => new Map<number, ServiceForPricing & Service>(services.map((s) => [s.id, s])),
    [services],
  );
  const priced = useMemo(
    () =>
      priceType
        ? priceQuotation(lines, servicesById, priceType, customer?.stateCode ?? null, pricing)
        : priceQuotation([], servicesById, priceTypeFor({ category: "MSME", isMcciaMember: false }, pricing), null, pricing),
    [lines, servicesById, priceType, customer?.stateCode, pricing],
  );
  const deptName = (code: string | null) => departments.find((d) => d.code === code)?.name;

  const defaultSubject = useMemo(() => {
    const codes = [...new Set(lines.map((l) => l.deptCode).filter((c): c is string => !!c))];
    const use = codes.length ? codes : customer?.deptCodes ?? [];
    const names = departments.filter((d) => use.includes(d.code)).map((d) => d.name);
    if (!names.length) return "Quotation for testing and prototyping services";
    const joined = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
    return `Quotation for ${joined} services`;
  }, [lines, customer, departments]);
  const effectiveSubject = subjectTouched ? subject : defaultSubject;

  // ---- Navigation -----------------------------------------------------------------
  const scrollTop = () => requestAnimationFrame(() => topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  const problemFor = (s: Step): string | null => {
    if (s >= 2 && !customer) return "Please choose a customer first.";
    if (s >= 3 && !lines.length) return "Please add at least one service.";
    if (s >= 4) {
      if (!effectiveSubject.trim()) return "Please enter a subject.";
      if (!quoteDate || !validUntil) return "Please choose the dates.";
      if (validUntil < quoteDate) return "“Valid until” must be on or after the quotation date.";
    }
    return null;
  };
  const goTo = (s: Step) => {
    for (let k = 2; k <= s; k++) {
      const p = problemFor(k as Step);
      if (p) {
        setStepError(p);
        setStep((k - 1) as Step);
        scrollTop();
        return;
      }
    }
    setStepError(null);
    setStep(s);
    scrollTop();
  };

  // ---- Lines ------------------------------------------------------------------------
  const upsertLine = (l: DraftLine) => {
    touch();
    setLines((cur) => (cur.some((x) => x.key === l.key) ? cur.map((x) => (x.key === l.key ? l : x)) : [...cur, l]));
    setStepError(null);
  };
  const removeLine = (key: string) => {
    const idx = lines.findIndex((l) => l.key === key);
    const removed = lines[idx];
    touch();
    setLines((cur) => cur.filter((l) => l.key !== key));
    toast.success(`${removed.description} removed`, {
      duration: 5000,
      action: {
        label: "Undo",
        onClick: () => setLines((cur) => [...cur.slice(0, idx), removed, ...cur.slice(idx)]),
      },
    });
  };
  const chooseCustomer = (id: string) => {
    touch();
    setCustomerId(id);
    setStepError(null);
    // Saved rates belong to the old customer: re-price for the new one.
    setLines((cur) => cur.map((l) => (l.locked ? { ...l, locked: null } : l)));
  };

  const rateLine = lines.find((l) => l.key === rateKey) ?? null;
  const rateLineService = rateLine?.serviceId != null ? servicesById.get(rateLine.serviceId) : undefined;
  const rateLineCard =
    rateLineService && priceType ? customerRate(rateLineService, priceType).finalRatePaise : (rateLine?.customRatePaise ?? 0);

  // ---- Save ---------------------------------------------------------------------------
  const save = (after: "view" | "download" | "print") => {
    const p = problemFor(4);
    if (p) {
      setStepError(p);
      toast.error(p);
      return;
    }
    startSaving(async () => {
      const res = await saveQuotation(
        {
          customerId: customerId!,
          quoteDate,
          validUntil,
          subject: effectiveSubject.trim(),
          notes: notes.trim() || null,
          terms,
          status: existing?.status ?? "DRAFT",
          lines,
          ...(!existing && fromLead ? { leadId: fromLead.id } : {}),
        },
        existing?.id ?? null,
      );
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      clearDraft(storageKey);
      setDirty(false);
      toast.success(
        existing ? `Quotation ${res.data.quoteNo} saved` : `Quotation ${res.data.quoteNo} saved as draft`,
        res.data.movedTo && fromLead ? { description: `Enquiry ${fromLead.leadNo} moved to ${res.data.movedTo}.` } : undefined,
      );
      if (after === "download") {
        const a = document.createElement("a");
        a.href = `/quotations/${res.data.id}/pdf?download=1`;
        a.download = "";
        a.dataset.skipUnsaved = "";
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      router.push(`/quotations/${res.data.id}${after === "print" ? "?print=1" : ""}`);
    });
  };

  const discardDraft = () => {
    clearDraft(storageKey);
    window.location.reload();
  };

  // ---- Preview model ---------------------------------------------------------------------
  const view =
    customer && priceType
      ? viewFromLive({
          settings,
          quoteNo: existing?.quoteNo ?? nextQuoteNo,
          quoteDate,
          validUntil,
          customer,
          priceTypeLabel: priceType.label,
          discountPct: priceType.discountPct,
          subject: effectiveSubject,
          notes: notes.trim() || null,
          terms,
          lines: priced.lines,
          totals: priced.totals,
        })
      : null;

  // The customer's usual services, plus the ones the enquiry asked about.
  const quickAdd = customer
    ? [...new Set([...customer.serviceIds, ...(!existing && fromLead ? fromLead.serviceIds : [])])]
        .map((id) => servicesById.get(id))
        .filter((s): s is Service => !!s && s.isActive)
        .sort((a, b) => a.sortOrder - b.sortOrder)
    : [];

  return (
    <div ref={topRef} className="scroll-mt-24">
      {fromLead && !existing ? (
        <p className="mb-4 flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-950 print:hidden">
          <Handshake className="size-4 shrink-0" aria-hidden />
          <span>
            From enquiry <strong>{fromLead.leadNo}</strong>: {fromLead.title}. Its services are in “Services this customer uses”.
          </span>
        </p>
      ) : null}
      {/* Step tabs */}
      <div className="print:hidden">
        <StepProgress step={step} total={4} label={STEP_LABELS[step]} />
        <ol className="-mt-3 mb-6 hidden gap-2 sm:flex" aria-label="Steps">
          {([1, 2, 3, 4] as Step[]).map((s) => (
            <li key={s} className="flex-1">
              <button
                type="button"
                onClick={() => goTo(s)}
                aria-current={step === s ? "step" : undefined}
                className={cn(
                  "w-full rounded-lg px-2 py-2 text-left text-sm font-medium transition",
                  step === s ? "bg-secondary text-primary" : "text-muted-foreground hover:bg-secondary/60",
                )}
              >
                {s}. {STEP_LABELS[s]}
              </button>
            </li>
          ))}
        </ol>

        {restored ? (
          <div className="mb-6 flex flex-col gap-3 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sky-900 sm:flex-row sm:items-center">
            <Info className="size-5 shrink-0" aria-hidden />
            <p className="flex-1">We brought back the quotation you had not finished, so nothing is lost.</p>
            <Button variant="outline" size="sm" onClick={discardDraft}>
              <RotateCcw aria-hidden /> Start over
            </Button>
          </div>
        ) : null}

        {stepError ? (
          <p role="alert" className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 font-medium text-red-800">
            {stepError}
          </p>
        ) : null}
      </div>

      <div className={cn("grid gap-8", step !== 4 && "lg:grid-cols-[minmax(0,1fr)_22rem]")}>
        <div className="min-w-0">
          {/* ------------------------------------------------------------ STEP 1 */}
          {step === 1 ? (
            <section className="flex flex-col gap-5" aria-labelledby="s1">
              <div>
                <h2 id="s1" className="text-2xl font-semibold">Who is this quotation for?</h2>
                <p className="text-muted-foreground">Their details fill in automatically.</p>
              </div>
              <CustomerPicker customers={customers} value={customerId} onChange={chooseCustomer} />
              <button
                type="button"
                onClick={() => setAddCustomerOpen(true)}
                className="inline-flex h-11 w-fit items-center gap-2 rounded-lg px-1 font-medium text-primary underline-offset-4 hover:underline"
              >
                <UserPlus className="size-5" aria-hidden /> Add new customer
              </button>
              {/* A customer just added from the side panel shows once the page data refreshes. */}
              {customerId && !customer ? (
                <p className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden /> Loading the new customer…
                </p>
              ) : null}
              {customer && priceType ? <CustomerCard customer={customer} priceBadge={priceType.badge} deptName={deptName} /> : null}
              <StepButtons>
                <span />
                <Button size="lg" onClick={() => goTo(2)}>
                  Continue <ArrowRight aria-hidden />
                </Button>
              </StepButtons>
            </section>
          ) : null}

          {/* ------------------------------------------------------------ STEP 2 */}
          {step === 2 && customer && priceType ? (
            <section className="flex flex-col gap-5" aria-labelledby="s2">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 id="s2" className="text-2xl font-semibold">Add services</h2>
                  <p className="text-muted-foreground">
                    For <strong className="text-primary">{customer.companyName}</strong> ·{" "}
                    <button type="button" className="font-medium text-primary underline-offset-4 hover:underline" onClick={() => goTo(1)}>
                      change
                    </button>
                  </p>
                </div>
                <span className="rounded-full bg-secondary px-3 py-1 text-sm font-medium text-primary">Price type: {priceType.badge}</span>
              </div>

              {quickAdd.length ? (
                <div className="rounded-2xl border bg-card p-4">
                  <h3 className="mb-3 flex items-center gap-2 font-semibold">
                    <Zap className="size-5 text-highlight" aria-hidden /> Services this customer uses
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {quickAdd.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setPanel({ open: true, editKey: null, startServiceId: s.id })}
                        className="inline-flex h-11 items-center gap-2 rounded-full border bg-card px-4 text-sm font-medium transition hover:border-primary hover:bg-secondary"
                      >
                        <Plus className="size-4" aria-hidden />
                        {s.name}
                        <span className="text-muted-foreground">
                          {formatINRShort(customerRate(s, priceType).finalRatePaise)} {s.unitLabel.replace(" (up to 3 samples)", "")}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {lines.length ? (
                <ul className="flex flex-col gap-3" aria-label="Services on this quotation">
                  {priced.lines.map((l, i) => (
                    <li key={l.draft.key} className="rounded-2xl border bg-card p-4 md:p-5">
                      <div className="flex gap-3">
                        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-primary">
                          {l.draft.deptCode ? <DeptIcon code={l.draft.deptCode} className="size-5" /> : <FileText className="size-5" aria-hidden />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm text-muted-foreground">{i + 1}.</span>
                            <span className="font-semibold">{l.draft.description}</span>
                            {l.isCustomRate ? <CustomRateTag /> : null}
                            {l.isCustomItem ? <span className="text-xs text-muted-foreground">(custom item)</span> : null}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {l.draft.deptCode ? `${l.draft.deptCode} - ${deptName(l.draft.deptCode)}` : "No department"}
                            {l.draft.notes ? ` · ${l.draft.notes}` : ""}
                          </div>
                          <div className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
                            <div>
                              <span className="text-muted-foreground">Quantity: </span>
                              {l.quantityText}
                            </div>
                            <div>
                              <span className="text-muted-foreground">Rate: </span>
                              {l.discountPct > 0 ? <s className="mr-1 text-muted-foreground">{formatINRShort(l.listRatePaise)}</s> : null}
                              {formatINRShort(l.finalRatePaise)} {l.draft.unitLabel.replace(" (up to 3 samples)", "")}
                            </div>
                            <div className="sm:text-right">
                              <span className="text-muted-foreground">Amount: </span>
                              <strong className="text-primary tabular-nums">{formatINR(l.amountPaise)}</strong>
                            </div>
                          </div>
                          {l.discountPct > 0 ? (
                            <p className="mt-1 text-xs text-muted-foreground">{priceType.label}</p>
                          ) : null}
                          <StockHintLine serviceId={l.draft.serviceId} billableQty={l.billableQty} unitLabel={l.draft.unitLabel} materials={materials} />
                          <SlotHint serviceId={l.draft.serviceId} billableQty={l.billableQty} />
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                l.isCustomItem
                                  ? setCustom({ open: true, editKey: l.draft.key })
                                  : setPanel({ open: true, editKey: l.draft.key, startServiceId: null })
                              }
                            >
                              <Pencil aria-hidden /> Edit
                            </Button>
                            {!l.isCustomItem ? (
                              <Button variant="ghost" size="sm" onClick={() => setRateKey(l.draft.key)}>
                                Change rate
                              </Button>
                            ) : null}
                            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => removeLine(l.draft.key)}>
                              <Trash2 aria-hidden /> Remove
                            </Button>
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="rounded-2xl border border-dashed bg-card px-6 py-10 text-center">
                  <p className="text-lg font-semibold text-primary">No services added yet</p>
                  <p className="text-muted-foreground">Use the button below, or tap one of their usual services above.</p>
                </div>
              )}

              <div className="flex flex-col gap-3 sm:flex-row">
                <Button size="lg" onClick={() => setPanel({ open: true, editKey: null, startServiceId: null })}>
                  <Plus aria-hidden /> Add a service
                </Button>
                <Button size="lg" variant="outline" onClick={() => setCustom({ open: true, editKey: null })}>
                  <Plus aria-hidden /> Add custom item
                </Button>
              </div>

              <StepButtons>
                <Button variant="outline" size="lg" onClick={() => goTo(1)}>
                  <ArrowLeft aria-hidden /> Back
                </Button>
                <Button size="lg" variant={lines.length ? "default" : "outline"} onClick={() => goTo(3)}>
                  Continue <ArrowRight aria-hidden />
                </Button>
              </StepButtons>
            </section>
          ) : null}

          {/* ------------------------------------------------------------ STEP 3 */}
          {step === 3 ? (
            <section className="flex flex-col gap-5" aria-labelledby="s3">
              <h2 id="s3" className="text-2xl font-semibold">Quotation details</h2>
              <div className="rounded-2xl border bg-card p-5 md:p-6">
                <div className="grid gap-5 md:grid-cols-2">
                  <div className="md:col-span-2">
                    <p className="text-base font-medium">Quotation number</p>
                    <p className="mt-1 text-lg font-semibold text-primary tabular-nums">{existing?.quoteNo ?? nextQuoteNo}</p>
                    <p className="text-sm text-muted-foreground">
                      {existing ? "This number stays the same." : "Given automatically when you save. Numbers are never reused."}
                    </p>
                  </div>
                  <Field label="Quotation date" required helper={formatDate(quoteDate)}>
                    {(p) => (
                      <Input
                        {...p}
                        type="date"
                        value={quoteDate}
                        onChange={(e) => {
                          touch();
                          const v = e.target.value;
                          setQuoteDate(v);
                          if (v) setValidUntil(addDaysIso(v, settings.quoteValidityDays));
                        }}
                      />
                    )}
                  </Field>
                  <Field
                    label="Valid until"
                    required
                    helper={`${formatDate(validUntil)} (${settings.quoteValidityDays} days from the quotation date by default)`}
                    error={validUntil && quoteDate && validUntil < quoteDate ? "This must be on or after the quotation date." : undefined}
                  >
                    {(p) => (
                      <Input
                        {...p}
                        type="date"
                        min={quoteDate}
                        value={validUntil}
                        onChange={(e) => {
                          touch();
                          setValidUntil(e.target.value);
                        }}
                      />
                    )}
                  </Field>
                  <Field
                    label="Subject"
                    required
                    className="md:col-span-2"
                    helper={subjectTouched ? "You changed the subject." : "Filled in from the departments. You can change it."}
                    error={!effectiveSubject.trim() ? "Please enter a subject." : undefined}
                  >
                    {(p) => (
                      <Input
                        {...p}
                        value={effectiveSubject}
                        maxLength={300}
                        onChange={(e) => {
                          touch();
                          setSubjectTouched(true);
                          setSubject(e.target.value);
                        }}
                      />
                    )}
                  </Field>
                  <Field label="Notes to customer" optional className="md:col-span-2" helper="Shown on the quotation, e.g. “Samples to be sent by courier.”">
                    {(p) => (
                      <Textarea
                        {...p}
                        rows={3}
                        value={notes}
                        maxLength={3000}
                        onChange={(e) => {
                          touch();
                          setNotes(e.target.value);
                        }}
                      />
                    )}
                  </Field>
                  <Field
                    label="Terms and conditions"
                    className="md:col-span-2"
                    helper={
                      <>
                        Filled in from Settings. Changes here apply to this quotation only.{" "}
                        {terms !== settings.defaultTerms ? (
                          <button
                            type="button"
                            className="font-medium text-primary underline-offset-4 hover:underline"
                            onClick={() => {
                              touch();
                              setTerms(settings.defaultTerms);
                            }}
                          >
                            Use the standard terms again
                          </button>
                        ) : null}
                      </>
                    }
                  >
                    {(p) => (
                      <Textarea
                        {...p}
                        rows={7}
                        value={terms}
                        maxLength={6000}
                        onChange={(e) => {
                          touch();
                          setTerms(e.target.value);
                        }}
                      />
                    )}
                  </Field>
                </div>
              </div>
              <StepButtons>
                <Button variant="outline" size="lg" onClick={() => goTo(2)}>
                  <ArrowLeft aria-hidden /> Back
                </Button>
                <Button size="lg" onClick={() => goTo(4)}>
                  See preview <ArrowRight aria-hidden />
                </Button>
              </StepButtons>
            </section>
          ) : null}

          {/* ------------------------------------------------------------ STEP 4 */}
          {step === 4 && view ? (
            <section className="flex flex-col gap-5" aria-labelledby="s4">
              <div className="flex flex-col gap-1 print:hidden">
                <h2 id="s4" className="text-2xl font-semibold">Preview</h2>
                <p className="text-muted-foreground">This is exactly how the PDF will look. Check it, then save.</p>
                {!existing ? (
                  <p className="mt-2 flex items-center gap-2 rounded-xl border border-highlight/40 bg-highlight/10 px-4 py-2.5 text-sm text-highlight-foreground">
                    <Info className="size-4 shrink-0" aria-hidden />
                    The quotation number is confirmed when you save. If someone else saves one first, you get the next number.
                  </p>
                ) : null}
              </div>
              <QuotationPaper view={view} />
              <div className="sticky bottom-32 z-10 flex flex-col gap-3 rounded-2xl border bg-card/95 p-4 shadow-lg backdrop-blur sm:flex-row sm:items-center sm:justify-between lg:bottom-4 print:hidden">
                <Button variant="outline" size="lg" onClick={() => goTo(3)}>
                  <ArrowLeft aria-hidden /> Back
                </Button>
                <div className="flex flex-col-reverse gap-3 sm:flex-row">
                  <Button variant="outline" size="lg" onClick={() => save("print")} disabled={saving}>
                    <Printer aria-hidden /> Print
                  </Button>
                  <Button variant="outline" size="lg" onClick={() => save("view")} disabled={saving}>
                    <Save aria-hidden /> {existing ? "Save changes" : "Save as draft"}
                  </Button>
                  <Button size="lg" onClick={() => save("download")} disabled={saving}>
                    {saving ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
                    Save and download PDF
                  </Button>
                </div>
              </div>
            </section>
          ) : null}
        </div>

        {step !== 4 ? (
          <div className="hidden lg:block print:hidden">
            <LiveSummaryCard
              totals={priced.totals}
              discountPct={priceType?.discountPct ?? 0}
              priceLabel={priceType?.label ?? null}
              lineCount={lines.length}
            />
          </div>
        ) : null}
      </div>

      {step !== 4 && lines.length ? (
        <LiveSummaryBar totals={priced.totals} discountPct={priceType?.discountPct ?? 0} priceLabel={priceType?.label ?? null} lineCount={lines.length} />
      ) : null}

      {/* Panels and dialogs */}
      {priceType && customer ? (
        <ServicePanel
          open={panel.open}
          onOpenChange={(o) => setPanel((p) => ({ ...p, open: o }))}
          departments={departments}
          services={services}
          priceType={priceType}
          preferredDepts={customer.deptCodes}
          editing={panel.editKey ? (lines.find((l) => l.key === panel.editKey) ?? null) : null}
          startServiceId={panel.startServiceId}
          onSubmit={(l) => {
            upsertLine(l);
            setPanel({ open: false, editKey: null, startServiceId: null });
            toast.success(panel.editKey ? "Service updated" : `${l.description} added`);
          }}
        />
      ) : null}
      <CustomItemDialog
        open={custom.open}
        onOpenChange={(o) => setCustom((c) => ({ ...c, open: o }))}
        departments={departments}
        editing={custom.editKey ? (lines.find((l) => l.key === custom.editKey) ?? null) : null}
        onSubmit={(l) => {
          upsertLine(l);
          setCustom({ open: false, editKey: null });
          toast.success(custom.editKey ? "Item updated" : `${l.description} added`);
        }}
      />
      <ChangeRateDialog
        line={rateLine}
        cardRatePaise={rateLineCard}
        cardRateLabel={priceType?.label ?? ""}
        onOpenChange={(o) => !o && setRateKey(null)}
        onSubmit={(r) => {
          if (rateLine) upsertLine({ ...rateLine, customRatePaise: r, locked: r == null ? null : rateLine.locked });
          setRateKey(null);
          toast.success(r == null ? "Rate card price is back" : "Rate changed");
        }}
      />
      <Sheet open={addCustomerOpen} onOpenChange={setAddCustomerOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto p-5 sm:max-w-3xl">
          <SheetHeader className="p-0 pb-4">
            <SheetTitle>Add new customer</SheetTitle>
            <SheetDescription>When you save, you come straight back here with the customer chosen.</SheetDescription>
          </SheetHeader>
          {addCustomerOpen ? (
            <CustomerWizard
              departments={departments}
              services={services}
              pricing={pricing}
              onCancel={() => setAddCustomerOpen(false)}
              onSaved={(c) => {
                setAddCustomerOpen(false);
                touch();
                chooseCustomer(c.id);
                router.refresh();
              }}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function StepButtons({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col-reverse gap-3 border-t pt-6 sm:flex-row sm:justify-between print:hidden">{children}</div>;
}

function CustomerCard({
  customer: c,
  priceBadge,
  deptName,
}: {
  customer: BuilderCustomer;
  priceBadge: string;
  deptName: (code: string | null) => string | undefined;
}) {
  const items: [string, React.ReactNode][] = [
    ["Address", [c.addressLine1, c.addressLine2, `${c.city} - ${c.pincode}`, c.state].filter(Boolean).join(", ")],
    ["GSTIN", c.gstRegistered ? <span className="font-mono">{c.gstin}</span> : "Not registered under GST"],
    ["PAN", <span key="p" className="font-mono">{c.pan}</span>],
    ["Contact person", [c.pocName, c.pocDesignation].filter(Boolean).join(", ")],
    ["Phone", `+91 ${c.pocPhone}`],
    ["Email", <span key="e" className="break-all">{c.pocEmail}</span>],
    ["MCCIA Membership ID", c.isMcciaMember ? c.mcciaMembershipId : "Not a member"],
  ];
  return (
    <div className="rounded-2xl border bg-card p-5 md:p-6">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-xl font-semibold text-primary">{c.companyName}</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            <CategoryBadge category={c.category} />
            {c.isMcciaMember ? <MemberBadge /> : null}
          </div>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={`/customers/${c.id}/edit`}>
            <Pencil aria-hidden /> Edit customer
          </Link>
        </Button>
      </div>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[11rem_1fr]">
        {items.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-sm font-medium text-muted-foreground">{k}</dt>
            <dd className="-mt-2 sm:mt-0">{v}</dd>
          </div>
        ))}
        <dt className="text-sm font-medium text-muted-foreground">Departments</dt>
        <dd className="-mt-2 sm:mt-0">{c.deptCodes.map((d) => `${d} - ${deptName(d)}`).join(", ") || "None chosen"}</dd>
      </dl>
      <p className="mt-4 rounded-xl bg-primary px-4 py-3 font-medium text-primary-foreground">Price type: {priceBadge}</p>
    </div>
  );
}

/** Small hint under a line: green "Enough stock", or amber "Low stock: ...". Never blocks anything. */
function StockHintLine({ serviceId, billableQty, unitLabel, materials }: { serviceId: number | null; billableQty: number; unitLabel: string; materials: Record<number, Material[]> }) {
  if (serviceId == null || !(billableQty > 0)) return null;
  const hint = stockHint(suggestMaterials(billableQty, unitLabel, materials[serviceId] ?? []));
  if (!hint) return null;
  return (
    <p className={cn("mt-2 inline-flex items-start gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium", hint.ok ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900")}>
      {hint.ok ? <PackageCheck className="size-3.5 shrink-0" aria-hidden /> : <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />}
      {hint.text}
    </p>
  );
}
