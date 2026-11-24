"use client";

import { AlertTriangle, FileSpreadsheet, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Field } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { addInvoiceAction, checkInvoiceNumber } from "@/lib/actions/orders";
import type { BlobEnv, UploadedFile } from "@/lib/files";
import { formatDate } from "@/lib/format";
import { parseRupees } from "@/lib/money-input";
import type { BoardTicket } from "@/lib/orders-data";
import { formatINR, paiseToRupeeString } from "@/lib/pricing";
import { addDays, todayInIndia } from "@/lib/tickets";
import { FileField } from "./file-field";
import { groupTickets, ServiceChecklist, useToggleSet } from "./service-checklist";

/** The customer's tickets in Billing, grouped by PO, with the clicked card's PO ticked by default. */
function useBillingSelection(ticket: BoardTicket, tickets: BoardTicket[]) {
  const candidates = useMemo(
    () => tickets.filter((t) => t.customerId === ticket.customerId && t.stage === "BILLING"),
    [tickets, ticket.customerId],
  );
  const poKey = (t: BoardTicket) => t.po?.id ?? "none";
  const groups = useMemo(
    () => groupTickets(candidates, poKey, (t) => (t.po ? `PO ${t.po.number}, ${formatDate(t.po.date)}` : "No PO"), poKey(ticket)),
    [candidates, ticket],
  );
  const [selected, setSelected] = useState<Set<string>>(() => new Set([ticket.id, ...candidates.filter((t) => ticket.po && t.po?.id === ticket.po.id).map((t) => t.id)]));
  const toggle = useToggleSet(setSelected);
  const chosen = candidates.filter((t) => selected.has(t.id));
  return {
    groups,
    selected,
    toggle,
    chosen,
    beforeGst: chosen.reduce((s, t) => s + (t.taxablePaise ?? 0), 0),
    withGst: chosen.reduce((s, t) => s + (t.totalPaise ?? 0), 0),
  };
}

// ---- Export to Tally (manual Excel for now) -----------------------------------------------

export function ExportBillingDialog({ ticket, tickets, onClose, onDone }: { ticket: BoardTicket | null; tickets: BoardTicket[]; onClose: () => void; onDone: () => void }) {
  return (
    <Dialog open={!!ticket} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        {ticket ? <ExportBody key={ticket.id} ticket={ticket} tickets={tickets} onClose={onClose} onDone={onDone} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function ExportBody({ ticket, tickets, onClose, onDone }: { ticket: BoardTicket; tickets: BoardTicket[]; onClose: () => void; onDone: () => void }) {
  const sel = useBillingSelection(ticket, tickets);
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    try {
      const res = await fetch("/api/billing-export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticketIds: sel.chosen.map((t) => t.id) }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        toast.error(j?.error ?? "We couldn't prepare the file. Please try again.");
        return;
      }
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "Billing-details.xlsx";
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast.success("Billing details downloaded. Create the invoice in TallyPrime, then upload it here.");
      onDone();
    } catch {
      toast.error("The download didn't finish. Please check your internet and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          Export to Tally
          <span className="rounded-full bg-highlight/20 px-2 py-0.5 text-xs font-semibold text-highlight-foreground">Coming soon</span>
        </DialogTitle>
        <DialogDescription>
          Direct export to TallyPrime is coming soon. For now, download the billing details and create the invoice in TallyPrime.
        </DialogDescription>
      </DialogHeader>

      <ServiceChecklist legend="Bill together" groups={sel.groups} selected={sel.selected} selfId={ticket.id} onToggle={sel.toggle} />
      <p className="rounded-xl bg-muted/50 p-3 text-sm">
        {ticket.companyName}: {sel.chosen.length === 1 ? "1 service" : `${sel.chosen.length} services`},{" "}
        <strong className="tabular-nums">{formatINR(sel.beforeGst)}</strong> before GST, <strong className="tabular-nums">{formatINR(sel.withGst)}</strong> with GST.
      </p>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Close
        </Button>
        <Button type="button" onClick={download} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <FileSpreadsheet className="size-4" aria-hidden />}
          Download billing details (Excel)
        </Button>
      </DialogFooter>
    </div>
  );
}

// ---- Upload tax invoice ---------------------------------------------------------------------

export function InvoiceDialog({
  ticket,
  tickets,
  env,
  onClose,
  onDone,
}: {
  ticket: BoardTicket | null;
  tickets: BoardTicket[];
  env: BlobEnv;
  onClose: () => void;
  onDone: () => void;
}) {
  return (
    <Dialog open={!!ticket} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        {ticket ? <InvoiceForm key={ticket.id} ticket={ticket} tickets={tickets} env={env} onClose={onClose} onDone={onDone} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function InvoiceForm({
  ticket,
  tickets,
  env,
  onClose,
  onDone,
}: {
  ticket: BoardTicket;
  tickets: BoardTicket[];
  env: BlobEnv;
  onClose: () => void;
  onDone: () => void;
}) {
  const today = todayInIndia();
  const sel = useBillingSelection(ticket, tickets);
  const [number, setNumber] = useState("");
  const [date, setDate] = useState(today);
  const [amountText, setAmountText] = useState("");
  const [file, setFile] = useState<UploadedFile | null>(null);
  const [uploading, setUploading] = useState(false);
  const [creditText, setCreditText] = useState(String(ticket.contact.creditDays));
  const [dueOverride, setDueOverride] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [numberUsed, setNumberUsed] = useState<{ no: string; message: string } | null>(null);

  useEffect(() => {
    const no = number.trim();
    if (!no) return;
    let stale = false;
    const t = setTimeout(async () => {
      const r = await checkInvoiceNumber(no);
      if (!stale && r.ok) setNumberUsed(r.data ? { no, message: r.data } : null);
    }, 350);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [number]);
  const usedMessage = numberUsed && numberUsed.no === number.trim() ? numberUsed.message : null;

  const creditDays = /^\d{1,3}$/.test(creditText.trim()) ? Number(creditText.trim()) : null;
  const autoDue = date && creditDays !== null ? addDays(date, creditDays) : "";
  const due = dueOverride ?? autoDue;
  const amount = parseRupees(amountText);

  const errors = {
    number: !number.trim() ? "Please enter the invoice number, e.g. MCCIA/2026-27/0456." : (usedMessage ?? undefined),
    date: !date ? "Please enter the invoice date." : date > today ? "The invoice date can't be in the future." : undefined,
    amount: !amountText.trim() ? "Please enter the invoice amount including GST." : amount === null || amount <= 0 ? "Please enter the amount in rupees, e.g. 8496 or 8496.50." : undefined,
    file: !file ? "Please upload the tax invoice (PDF, JPG or PNG)." : undefined,
    credit: creditDays === null || creditDays > 365 ? "Please enter the number of days, from 0 to 365." : undefined,
    due: !due ? "Please enter the due date." : date && due < date ? "The due date can't be before the invoice date." : undefined,
  };
  const hasErrors = Object.values(errors).some(Boolean);
  const differs = amount !== null && amount > 0 && Math.abs(amount - sel.withGst) > 100;

  async function save() {
    setTouched(true);
    if (hasErrors || uploading) return;
    setSaving(true);
    const r = await addInvoiceAction({
      ticketIds: sel.chosen.map((t) => t.id),
      invoiceNumber: number.trim(),
      invoiceDate: date,
      amountPaise: amount!,
      creditDays: creditDays!,
      dueDate: due,
      fileId: file!.id,
    });
    setSaving(false);
    if (!r.ok) return void toast.error(r.message);
    const n = r.data.moved.length;
    toast.success(`Invoice ${r.data.invoiceNumber} saved. ${n === 1 ? "1 service" : `${n} services`} moved to Payment follow-up, due ${formatDate(r.data.dueDate)}.`);
    onDone();
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <DialogHeader>
        <DialogTitle>Upload tax invoice</DialogTitle>
        <DialogDescription>
          {ticket.companyName}. Saving moves the ticked services to <strong>Payment follow-up</strong>.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Invoice number" required helper="As printed on the tax invoice." error={touched || usedMessage ? errors.number : undefined} className="sm:col-span-2">
          {(p) => <Input {...p} value={number} onChange={(e) => setNumber(e.target.value)} maxLength={60} autoComplete="off" autoFocus />}
        </Field>
        <Field label="Invoice date" required error={touched ? errors.date : undefined}>
          {(p) => <Input {...p} type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />}
        </Field>
        <Field label="Invoice amount incl. GST" required error={touched ? errors.amount : undefined}>
          {(p) => (
            <InputGroup className="h-11 rounded-xl bg-card">
              <InputGroupAddon>
                <InputGroupText>₹</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput {...p} className="text-base" inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder={paiseToRupeeString(sel.withGst)} />
            </InputGroup>
          )}
        </Field>
        {!amountText && sel.withGst > 0 ? (
          <Button type="button" variant="outline" size="sm" className="justify-self-start sm:col-span-2" onClick={() => setAmountText(paiseToRupeeString(sel.withGst))}>
            Use selected services&apos; total ({formatINR(sel.withGst)})
          </Button>
        ) : null}
        <Field label="Credit period (days)" required helper={`From the customer's details (usually 30).`} error={touched ? errors.credit : undefined}>
          {(p) => (
            <Input
              {...p}
              inputMode="numeric"
              value={creditText}
              onChange={(e) => {
                setCreditText(e.target.value);
                setDueOverride(null);
              }}
            />
          )}
        </Field>
        <Field label="Due date" required helper={dueOverride ? "Changed by you." : "Invoice date + credit period. You can change it."} error={touched ? errors.due : undefined}>
          {(p) => <Input {...p} type="date" value={due} min={date || undefined} onChange={(e) => setDueOverride(e.target.value || null)} />}
        </Field>
      </div>

      <Field label="Tax invoice file" required error={touched ? errors.file : undefined}>
        {(p) => <FileField id={p.id} describedBy={p["aria-describedby"]} invalid={touched && !file} kind="INVOICE" env={env} value={file} onChange={setFile} onBusyChange={setUploading} />}
      </Field>

      <ServiceChecklist legend="This invoice also covers" groups={sel.groups} selected={sel.selected} selfId={ticket.id} onToggle={sel.toggle} />

      <div className="flex flex-col gap-2 rounded-xl bg-muted/50 p-3 text-sm" aria-live="polite">
        <p>
          Invoice amount <strong className="tabular-nums">{amount ? formatINR(amount) : "–"}</strong>. Selected services:{" "}
          <strong className="tabular-nums">{formatINR(sel.withGst)}</strong> with GST.
        </p>
        {differs ? (
          <p className="flex items-start gap-2 font-medium text-amber-800 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            The invoice amount is different from the selected services&apos; total. Please check before saving.
          </p>
        ) : null}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Not now
        </Button>
        <Button type="submit" disabled={saving || uploading}>
          {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          Save invoice and move to Payment
        </Button>
      </DialogFooter>
    </form>
  );
}
