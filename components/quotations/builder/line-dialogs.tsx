"use client";

import { useState } from "react";
import { Field } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Department } from "@/db/schema";
import { formatINR, formatINRShort, lineAmount, toPaise } from "@/lib/pricing";
import type { DraftLine } from "@/lib/quote-calc";

const NO_DEPT = "none";

/** "+ Add custom item": extra operations that are not on the rate card. */
type CustomItemProps = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  departments: Department[];
  editing: DraftLine | null;
  onSubmit: (l: DraftLine) => void;
};

export function CustomItemDialog(props: CustomItemProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        {props.open ? <CustomItemForm key={props.editing?.key ?? "new"} {...props} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function CustomItemForm({ onOpenChange, departments, editing, onSubmit }: CustomItemProps) {
  const [description, setDescription] = useState(editing?.description ?? "");
  const [quantity, setQuantity] = useState(editing?.quantity?.toString() ?? "");
  const [unit, setUnit] = useState(editing?.unitLabel.replace(/^per\s+/i, "") ?? "");
  const [rate, setRate] = useState(editing?.customRatePaise != null ? String(editing.customRatePaise / 100) : "");
  const [dept, setDept] = useState(editing?.deptCode ?? NO_DEPT);
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [showErrors, setShowErrors] = useState(false);
  const [lineKey] = useState(() => editing?.key ?? crypto.randomUUID());

  const q = Number(quantity);
  const r = Number(rate);
  const errors = {
    description: !description.trim() ? "Please describe the item, e.g. Fixture making." : undefined,
    quantity: !(q > 0) ? "Enter a quantity more than 0." : undefined,
    unit: !unit.trim() ? "Enter a unit, e.g. piece, set or job." : undefined,
    rate: !(r > 0) ? "Enter a rate more than ₹0." : undefined,
  };
  const ok = !Object.values(errors).some(Boolean);
  const amount = ok ? lineAmount(q, toPaise(r)) : 0;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ok) return setShowErrors(true);
    onSubmit({
      key: lineKey,
      serviceId: null,
      deptCode: dept === NO_DEPT ? null : dept,
      description: description.trim(),
      unitType: null,
      unitLabel: `per ${unit.trim()}`,
      quantity: q,
      customRatePaise: toPaise(r),
      notes: notes.trim() || null,
    });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <DialogHeader>
        <DialogTitle>{editing ? "Change custom item" : "Add custom item"}</DialogTitle>
        <DialogDescription>
          For extra work that is not on the rate card. The member discount is not applied to custom items.
        </DialogDescription>
      </DialogHeader>
      <Field
        label="Description"
        required
        helper="e.g. Fixture making for salt spray test"
        error={showErrors ? errors.description : undefined}
      >
        {(p) => <Input {...p} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} autoFocus />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Quantity" required helper="e.g. 2" error={showErrors ? errors.quantity : undefined}>
          {(p) => (
            <Input
              {...p}
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          )}
        </Field>
        <Field label="Unit" required helper="e.g. piece" error={showErrors ? errors.unit : undefined}>
          {(p) => <Input {...p} value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={40} />}
        </Field>
        <Field label="Rate (₹)" required helper="per unit" error={showErrors ? errors.rate : undefined}>
          {(p) => (
            <Input {...p} type="number" min={0} step="any" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
          )}
        </Field>
      </div>
      <Field label="Department" optional>
        {(p) => (
          <Select value={dept} onValueChange={setDept}>
            <SelectTrigger {...p} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_DEPT}>No department</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d.code} value={d.code}>
                  {d.code} - {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>
      <Field label="Notes" optional>
        {(p) => <Input {...p} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />}
      </Field>
      <p className="rounded-xl bg-secondary px-4 py-3 text-lg font-semibold text-primary tabular-nums" aria-live="polite">
        {ok ? `${quantity} ${unit} x ${formatINRShort(toPaise(r))} = ${formatINR(amount)}` : "Fill in the details to see the amount."}
      </p>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button type="submit">{editing ? "Save changes" : "Add to quotation"}</Button>
      </DialogFooter>
    </form>
  );
}

/** "Change rate": staff can override the rate-card price on one line. */
type ChangeRateProps = {
  line: DraftLine | null;
  /** The price this customer would normally get, for reference. */
  cardRatePaise: number;
  cardRateLabel: string;
  onOpenChange: (o: boolean) => void;
  onSubmit: (customRatePaise: number | null) => void;
};

export function ChangeRateDialog(props: ChangeRateProps) {
  return (
    <Dialog open={!!props.line} onOpenChange={props.onOpenChange}>
      <DialogContent>{props.line ? <ChangeRateForm key={props.line.key} {...props} line={props.line} /> : null}</DialogContent>
    </Dialog>
  );
}

function ChangeRateForm({ line, cardRatePaise, cardRateLabel, onOpenChange, onSubmit }: ChangeRateProps & { line: DraftLine }) {
  const [rate, setRate] = useState(line.customRatePaise != null ? String(line.customRatePaise / 100) : String(cardRatePaise / 100));
  const [showError, setShowError] = useState(false);
  const r = Number(rate);
  const valid = rate.trim() !== "" && r >= 0;

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return setShowError(true);
        onSubmit(toPaise(r));
      }}
      className="flex flex-col gap-5"
    >
      <DialogHeader>
        <DialogTitle>Change rate</DialogTitle>
        <DialogDescription>
          {line.description}. Rate card price for this customer: <strong>{formatINRShort(cardRatePaise)}</strong> {line.unitLabel} (
          {cardRateLabel}).
        </DialogDescription>
      </DialogHeader>
      <Field
        label={`New rate (₹ ${line.unitLabel ?? ""})`}
        required
        helper="This exact rate is used. The member discount is not taken off again."
        error={showError ? "Please enter a rate of ₹0 or more." : undefined}
      >
        {(p) => (
          <Input
            {...p}
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            autoFocus
          />
        )}
      </Field>
      <DialogFooter className="sm:justify-between">
        {line.customRatePaise != null ? (
          <Button type="button" variant="ghost" onClick={() => onSubmit(null)}>
            Go back to rate card price
          </Button>
        ) : (
          <span />
        )}
        <div className="flex flex-col-reverse gap-3 sm:flex-row">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit">Use this rate</Button>
        </div>
      </DialogFooter>
    </form>
  );
}
