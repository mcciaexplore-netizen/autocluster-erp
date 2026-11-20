"use client";

import { Printer } from "lucide-react";
import { useState } from "react";
import { Field } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

const PER_SHEET = 24;

/** "Print label": choose how many, then the label sheet (PDF) opens in a new tab to print. */
export function LabelButton({ itemId, batchId, batchNo, size = "lg", variant = "outline" }: { itemId: string; batchId?: string; batchNo?: string; size?: "lg" | "sm"; variant?: "outline" | "ghost" }) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(String(PER_SHEET));
  const [outline, setOutline] = useState(true);
  const n = Math.floor(Number(count));
  const error = !(n >= 1 && n <= PER_SHEET) ? `Enter a number from 1 to ${PER_SHEET}.` : undefined;
  const href = `/api/inventory/labels?${new URLSearchParams({ item: itemId, ...(batchId ? { batch: batchId } : {}), count: String(n), ...(outline ? { outline: "1" } : {}) })}`;
  return (
    <>
      <Button size={size} variant={variant} onClick={() => setOpen(true)}>
        <Printer aria-hidden /> {batchNo ? "Label" : "Print label"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Print label{batchNo ? `: batch ${batchNo}` : ""}</DialogTitle>
            <DialogDescription>An A4 sheet of up to {PER_SHEET} labels (3 across, 8 down). Scanning the QR code with a phone camera opens this item, ready to use stock.</DialogDescription>
          </DialogHeader>
          <Field label="How many labels" required error={error}>
            {(p) => <Input {...p} inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} className="w-28" />}
          </Field>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <Checkbox checked={outline} onCheckedChange={(v) => setOutline(v === true)} />
            Show cut lines (for plain paper)
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button asChild disabled={!!error}>
              <a href={error ? undefined : href} target="_blank" rel="noopener" onClick={(e) => (error ? e.preventDefault() : setOpen(false))}>
                <Printer aria-hidden /> Open labels
              </a>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
