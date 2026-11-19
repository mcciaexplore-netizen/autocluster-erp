"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { Field } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

/** The Lost form: a reason is required; the card only moves once it is saved. */
export function LostDialog({
  open,
  title,
  reasons,
  pending,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  reasons: { id: string; name: string }[];
  pending?: boolean;
  onCancel: () => void;
  onConfirm: (v: { reasonId: string; note: string }) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>{open ? <Body title={title} reasons={reasons} pending={pending} onCancel={onCancel} onConfirm={onConfirm} /> : null}</DialogContent>
    </Dialog>
  );
}

function Body({ title, reasons, pending, onCancel, onConfirm }: Omit<Parameters<typeof LostDialog>[0], "open">) {
  const [reasonId, setReasonId] = useState("");
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);
  const error = reasonId ? undefined : "Please choose why the enquiry was lost.";
  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (!error) onConfirm({ reasonId, note: note.trim() });
      }}
    >
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>It moves to Lost once you save the reason. You can reopen it later by moving it back.</DialogDescription>
      </DialogHeader>
      <Field label="Lost reason" required error={touched ? error : undefined}>
        {(p) => (
          <Select value={reasonId} onValueChange={setReasonId}>
            <SelectTrigger {...p} className="w-full">
              <SelectValue placeholder="Choose a reason" />
            </SelectTrigger>
            <SelectContent>
              {reasons.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>
      <Field label="Note" optional helper="e.g. Went with a lab in Chakan at a lower rate">
        {(p) => <Textarea {...p} rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />}
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Keep it open
        </Button>
        <Button type="submit" disabled={pending} className="bg-destructive text-white hover:bg-destructive/90">
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null} Mark as lost
        </Button>
      </DialogFooter>
    </form>
  );
}
