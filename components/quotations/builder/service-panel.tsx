"use client";

import { Check, Info } from "lucide-react";
import { useMemo, useState } from "react";
import { DeptIcon } from "@/components/customers/dept-icons";
import { Field } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import type { Department, Service } from "@/db/schema";
import {
  billableQuantity,
  customerRate,
  formatINR,
  formatINRShort,
  formatQty,
  runsForSamples,
  UNIT_LABELS,
  UNIT_SHORT,
  type PriceType,
} from "@/lib/pricing";
import { lineProblems, priceLine, type DraftLine } from "@/lib/quote-calc";
import { cn } from "@/lib/utils";

type Qty = { ccPerPart: string; parts: string; hours: string; samples: string };
const EMPTY_QTY: Qty = { ccPerPart: "", parts: "", hours: "", samples: "" };

const num = (s: string) => (s.trim() === "" ? null : Number(s));
const int = (s: string) => (s.trim() === "" ? null : Math.floor(Number(s)));

type PanelProps = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  departments: Department[];
  services: Service[];
  priceType: PriceType;
  preferredDepts: string[];
  editing: DraftLine | null;
  startServiceId: number | null;
  onSubmit: (line: DraftLine) => void;
};

/** The panel's fields start fresh each time it opens (the body is remounted with a new key). */
export function ServicePanel(props: PanelProps) {
  const [session, setSession] = useState(0);
  return (
    <Sheet
      open={props.open}
      onOpenChange={(o) => {
        if (o) setSession((n) => n + 1);
        props.onOpenChange(o);
      }}
    >
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-xl">
        {props.open ? <PanelBody key={`${session}-${props.editing?.key ?? "new"}-${props.startServiceId ?? ""}`} {...props} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function PanelBody({ departments, services, priceType, preferredDepts, editing, startServiceId, onSubmit }: PanelProps) {
  const start = services.find((s) => s.id === (editing?.serviceId ?? startServiceId));
  const [dept, setDept] = useState<string | null>(start?.deptCode ?? (preferredDepts.length === 1 ? preferredDepts[0] : null));
  const [serviceId, setServiceId] = useState<number | null>(start?.id ?? null);
  const [qty, setQty] = useState<Qty>(
    editing
      ? {
          ccPerPart: editing.ccPerPart?.toString() ?? "",
          parts: editing.parts?.toString() ?? "",
          hours: editing.hours?.toString() ?? "",
          samples: editing.samples?.toString() ?? "",
        }
      : EMPTY_QTY,
  );
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [showErrors, setShowErrors] = useState(false);
  const [lineKey] = useState(() => editing?.key ?? crypto.randomUUID());

  const sortedDepts = useMemo(
    () =>
      [...departments].sort((a, b) => {
        const pa = preferredDepts.includes(a.code) ? 0 : 1;
        const pb = preferredDepts.includes(b.code) ? 0 : 1;
        return pa - pb || a.sortOrder - b.sortOrder;
      }),
    [departments, preferredDepts],
  );

  const svc = services.find((s) => s.id === serviceId) ?? null;
  const deptServices = services.filter((s) => s.deptCode === dept && (s.isActive || s.id === serviceId));

  const draft: DraftLine | null = svc
    ? {
        key: lineKey,
        serviceId: svc.id,
        deptCode: svc.deptCode,
        description: svc.name,
        unitType: svc.unitType,
        unitLabel: svc.unitLabel,
        ccPerPart: svc.unitType === "PER_CC" ? num(qty.ccPerPart) : null,
        parts: svc.unitType === "PER_CC" ? int(qty.parts) : null,
        hours: svc.unitType === "PER_HOUR" || svc.unitType === "PER_HOUR_3_SAMPLES" ? num(qty.hours) : null,
        samples: svc.unitType === "PER_SAMPLE" || svc.unitType === "PER_HOUR_3_SAMPLES" ? int(qty.samples) : null,
        customRatePaise: editing?.serviceId === svc.id ? editing.customRatePaise : null,
        locked: editing?.serviceId === svc.id ? editing.locked : null,
        notes: notes.trim() || null,
      }
    : null;

  const problems = draft ? lineProblems(draft) : ["Please choose a service."];
  const priced = draft && !problems.length ? priceLine(draft, svc!, priceType) : null;
  const qtyNow = draft ? billableQuantity(draft.unitType, draft) : 0;

  const submit = () => {
    if (!draft || problems.length) {
      setShowErrors(true);
      return;
    }
    onSubmit(draft);
  };

  const err = (cond: boolean, msg: string) => (showErrors && cond ? msg : undefined);
  const setQ = (k: keyof Qty) => (e: React.ChangeEvent<HTMLInputElement>) => setQty((q) => ({ ...q, [k]: e.target.value }));
  const numberProps = { type: "number" as const, min: 0, inputMode: "decimal" as const };

  return (
    <>
      <SheetHeader className="border-b p-5">
        <SheetTitle>{editing ? "Change this service" : "Add a service"}</SheetTitle>
        <SheetDescription>Pick the department and service, then enter how much is needed.</SheetDescription>
      </SheetHeader>

      <div className="flex-1 space-y-7 overflow-y-auto p-5">
        {/* 1. Department */}
        <section>
          <h3 className="mb-2.5 font-semibold">1. Department</h3>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Department">
            {sortedDepts.map((d) => (
              <button
                key={d.code}
                type="button"
                aria-pressed={dept === d.code}
                onClick={() => {
                  setDept(d.code);
                  if (svc?.deptCode !== d.code) setServiceId(null);
                }}
                className={cn(
                  "inline-flex h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium transition",
                  dept === d.code ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-primary/40",
                )}
              >
                <DeptIcon code={d.code} className="size-4" />
                {d.code} - {d.name}
                {preferredDepts.includes(d.code) && dept !== d.code ? (
                  <span className="rounded-full bg-secondary px-1.5 text-[11px] text-primary">theirs</span>
                ) : null}
              </button>
            ))}
          </div>
        </section>

        {/* 2. Service */}
        {dept ? (
          <section>
            <h3 className="mb-2.5 font-semibold">2. Service or machine</h3>
            <ul className="grid gap-2" role="radiogroup" aria-label="Service or machine">
              {deptServices.map((s) => {
                const r = customerRate(s, priceType);
                const active = s.id === serviceId;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setServiceId(s.id)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-xl border-2 bg-card p-3.5 text-left transition",
                        active ? "border-primary bg-secondary" : "hover:border-primary/40",
                      )}
                    >
                      <span
                        className={cn(
                          "grid size-5 shrink-0 place-items-center rounded-full border-2",
                          active ? "border-primary bg-primary text-primary-foreground" : "border-input",
                        )}
                        aria-hidden
                      >
                        {active ? <Check className="size-3" /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{s.name}</span>
                        <span className="block text-sm text-muted-foreground">Charged {UNIT_LABELS[s.unitType]}</span>
                      </span>
                      <span className="text-right">
                        {r.finalRatePaise !== r.listRatePaise ? (
                          <s className="block text-xs text-muted-foreground">{formatINRShort(r.listRatePaise)}</s>
                        ) : null}
                        <span className="font-semibold text-success">{formatINRShort(r.finalRatePaise)}</span>
                        <span className="block text-xs text-muted-foreground">{s.unitLabel}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {/* 3. Quantity */}
        {svc ? (
          <section>
            <h3 className="mb-2.5 font-semibold">3. How much?</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              {svc.unitType === "PER_CC" ? (
                <>
                  <Field
                    label="Volume per part (cc)"
                    required
                    helper="e.g. 50"
                    error={err(!(Number(qty.ccPerPart) > 0), "Enter the volume per part in cc.")}
                  >
                    {(p) => <Input {...p} {...numberProps} step="any" value={qty.ccPerPart} onChange={setQ("ccPerPart")} autoFocus />}
                  </Field>
                  <Field
                    label="Number of parts"
                    required
                    helper="e.g. 4"
                    error={err(!(Number(qty.parts) > 0), "Enter the number of parts.")}
                  >
                    {(p) => <Input {...p} {...numberProps} step={1} inputMode="numeric" value={qty.parts} onChange={setQ("parts")} />}
                  </Field>
                </>
              ) : null}
              {svc.unitType === "PER_HOUR" ? (
                <Field
                  label="Machine hours"
                  required
                  helper="e.g. 6 or 2.5"
                  error={err(!(Number(qty.hours) > 0), "Enter the machine hours.")}
                >
                  {(p) => <Input {...p} {...numberProps} step="any" value={qty.hours} onChange={setQ("hours")} autoFocus />}
                </Field>
              ) : null}
              {svc.unitType === "PER_SAMPLE" ? (
                <Field
                  label="Number of samples"
                  required
                  helper="e.g. 5"
                  error={err(!(Number(qty.samples) > 0), "Enter the number of samples.")}
                >
                  {(p) => (
                    <Input {...p} {...numberProps} step={1} inputMode="numeric" value={qty.samples} onChange={setQ("samples")} autoFocus />
                  )}
                </Field>
              ) : null}
              {svc.unitType === "PER_HOUR_3_SAMPLES" ? (
                <>
                  <Field label="Test hours" required helper="e.g. 8" error={err(!(Number(qty.hours) > 0), "Enter the test hours.")}>
                    {(p) => <Input {...p} {...numberProps} step="any" value={qty.hours} onChange={setQ("hours")} autoFocus />}
                  </Field>
                  <Field
                    label="Number of samples"
                    required
                    helper="One run holds up to 3 samples"
                    error={err(!(Number(qty.samples) > 0), "Enter the number of samples.")}
                  >
                    {(p) => <Input {...p} {...numberProps} step={1} inputMode="numeric" value={qty.samples} onChange={setQ("samples")} />}
                  </Field>
                  {Number(qty.samples) > 0 ? (
                    <p className="flex gap-2 text-sm text-muted-foreground sm:col-span-2">
                      <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
                      {qty.samples} {Number(qty.samples) === 1 ? "sample needs" : "samples need"} {runsForSamples(Number(qty.samples))}{" "}
                      {runsForSamples(Number(qty.samples)) === 1 ? "run" : "runs"}.
                    </p>
                  ) : null}
                </>
              ) : null}
            </div>
          </section>
        ) : null}

        {/* 4. Notes */}
        {svc ? (
          <Field label="Notes for this service" optional helper="e.g. part name or test standard, like ASTM D412">
            {(p) => <Textarea {...p} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />}
          </Field>
        ) : null}
      </div>

      {/* 5. Live preview + add */}
      <SheetFooter className="border-t bg-secondary/50 p-5">
        <div aria-live="polite" className="mb-1 min-h-12">
          {priced && svc ? (
            <>
              <p className="text-lg font-semibold text-primary tabular-nums">
                {formatQty(qtyNow)} {UNIT_SHORT[svc.unitType]} x {formatINRShort(priced.finalRatePaise)} = {formatINR(priced.amountPaise)}
              </p>
              <p className="text-sm text-muted-foreground">
                {priced.isCustomRate
                  ? "Custom rate"
                  : editing?.locked && editing.serviceId === svc.id
                    ? "Rate as saved on this quotation"
                    : priceType.label}
              </p>
            </>
          ) : (
            <p className="text-muted-foreground">{svc ? "Enter the quantity to see the price." : "Choose a service to see the price."}</p>
          )}
        </div>
        {showErrors && problems.length && !svc ? <p className="text-sm font-medium text-destructive">{problems[0]}</p> : null}
        <Button size="lg" onClick={submit} className="w-full">
          <Check aria-hidden /> {editing ? "Save changes" : "Add to quotation"}
        </Button>
      </SheetFooter>
    </>
  );
}
