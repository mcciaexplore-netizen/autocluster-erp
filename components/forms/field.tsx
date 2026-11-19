"use client";

import { AlertCircle, AlertTriangle } from "lucide-react";
import { useId } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export interface FieldRenderProps {
  id: string;
  "aria-invalid": boolean;
  "aria-describedby": string;
  "aria-required"?: boolean;
}

/**
 * A form field with the label always visible above, a short helper line
 * with an example, and a friendly error (or warning) below.
 */
export function Field({
  label,
  helper,
  error,
  warning,
  required,
  optional,
  className,
  children,
}: {
  label: string;
  helper?: React.ReactNode;
  error?: string;
  warning?: string | null;
  required?: boolean;
  optional?: boolean;
  className?: string;
  children: (p: FieldRenderProps) => React.ReactNode;
}) {
  const id = useId();
  const helpId = `${id}-help`;
  const msgId = `${id}-msg`;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id} className="text-base font-medium text-foreground">
        {label}
        {required ? <span className="text-destructive" aria-hidden> *</span> : null}
        {optional ? <span className="font-normal text-muted-foreground"> (optional)</span> : null}
      </Label>
      {children({ id, "aria-invalid": !!error, "aria-describedby": `${helpId} ${msgId}`, "aria-required": required || undefined })}
      <div id={msgId} aria-live="polite">
        {error ? (
          <p className="flex items-start gap-1.5 text-sm font-medium text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {error}
          </p>
        ) : warning ? (
          <p className="flex items-start gap-1.5 text-sm font-medium text-amber-700">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {warning}
          </p>
        ) : null}
      </div>
      {helper ? (
        <p id={helpId} className="text-sm text-muted-foreground">
          {helper}
        </p>
      ) : (
        <span id={helpId} hidden />
      )}
    </div>
  );
}

/** A section card that groups related fields on a form. */
export function FormSection({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border bg-card p-5 shadow-[0_1px_3px_rgba(11,31,58,0.06)] md:p-7">
      <div className="mb-5 flex items-start gap-3">
        {icon ? <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-primary">{icon}</span> : null}
        <div>
          <h2 className="text-xl font-semibold text-primary">{title}</h2>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

/** Progress bar for step-by-step forms, e.g. "Step 2 of 3: Department". */
export function StepProgress({ step, total, label }: { step: number; total: number; label: string }) {
  return (
    <div className="mb-6">
      <p className="mb-2 text-base font-medium text-primary" aria-live="polite">
        Step {step} of {total}: {label}
      </p>
      <div
        className="h-2.5 overflow-hidden rounded-full bg-secondary"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={step}
        aria-label={`Step ${step} of ${total}`}
      >
        <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${(step / total) * 100}%` }} />
      </div>
    </div>
  );
}
