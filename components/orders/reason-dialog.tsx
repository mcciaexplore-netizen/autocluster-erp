"use client";

import { useState } from "react";
import { Field } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

/** Asks for a reason before moving a card back or cancelling a ticket. */
export function ReasonDialog({
  open,
  title,
  description,
  label,
  helper,
  confirmLabel,
  destructive,
  pending,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: React.ReactNode;
  label: string;
  helper: string;
  confirmLabel: string;
  destructive?: boolean;
  pending?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>{open ? <Body {...{ title, description, label, helper, confirmLabel, destructive, pending, onCancel, onConfirm }} /> : null}</DialogContent>
    </Dialog>
  );
}

function Body({
  title,
  description,
  label,
  helper,
  confirmLabel,
  destructive,
  pending,
  onCancel,
  onConfirm,
}: Omit<Parameters<typeof ReasonDialog>[0], "open">) {
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const error = reason.trim().length < 3 ? "Please write a short reason." : undefined;
  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (!error) onConfirm(reason.trim());
      }}
    >
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription asChild>
          <div>{description}</div>
        </DialogDescription>
      </DialogHeader>
      <Field label={label} required helper={helper} error={touched ? error : undefined}>
        {(p) => <Textarea {...p} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} autoFocus />}
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Keep as it is
        </Button>
        <Button type="submit" disabled={pending} className={destructive ? "bg-destructive text-white hover:bg-destructive/90" : undefined}>
          {confirmLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}
