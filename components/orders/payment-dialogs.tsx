"use client";

import { AlertTriangle, CheckCircle2, Loader2, Mail, MessageCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Field } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { addFollowUpAction, loadReminder, logReminderAction, recordPaymentAction } from "@/lib/actions/orders";
import { formatDate } from "@/lib/format";
import { parseRupees } from "@/lib/money-input";
import type { BoardTicket } from "@/lib/orders-data";
import { formatINR, paiseToRupeeString } from "@/lib/pricing";
import type { Reminder } from "@/lib/reminders";
import { invoiceChips, paymentProblem, todayInIndia } from "@/lib/tickets";
import { ToneChip } from "./stage-chip";

const MODES = [
  { value: "BANK", label: "Bank transfer", hint: "NEFT / RTGS / IMPS" },
  { value: "UPI", label: "UPI" },
  { value: "CHEQUE", label: "Cheque" },
  { value: "CASH", label: "Cash" },
] as const;
const METHODS = [
  { value: "CALL", label: "Call" },
  { value: "WHATSAPP", label: "WhatsApp" },
  { value: "EMAIL", label: "Email" },
  { value: "VISIT", label: "Visit" },
  { value: "OTHER", label: "Other" },
] as const;

type Props = { ticket: BoardTicket | null; onClose: () => void; onDone: () => void };

function Shell({ ticket, onClose, children }: { ticket: BoardTicket | null; onClose: () => void; children: (t: BoardTicket) => React.ReactNode }) {
  return (
    <Dialog open={!!ticket} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">{ticket ? children(ticket) : null}</DialogContent>
    </Dialog>
  );
}

/** "Invoice INV-123 · 3 services · ₹4,000 left" with the due chips. */
function InvoiceSummary({ ticket }: { ticket: BoardTicket }) {
  const inv = ticket.invoice!;
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-muted/50 p-3 text-sm">
      <p>
        Invoice <strong>{inv.number}</strong> dated {formatDate(inv.date)}
        {inv.ticketCount > 1 ? `, ${inv.ticketCount} services` : ""}. Total <strong className="tabular-nums">{formatINR(inv.amountPaise)}</strong>.
      </p>
      <p>
        Received so far <strong className="tabular-nums">{formatINR(inv.paidPaise)}</strong>
        {inv.tdsPaise ? (
          <>
            {" "}
            + TDS <strong className="tabular-nums">{formatINR(inv.tdsPaise)}</strong>
          </>
        ) : null}
        . Amount left <strong className="tabular-nums">{formatINR(inv.leftPaise)}</strong>.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {invoiceChips(inv).map((c) => (
          <ToneChip key={c.label} tone={c.tone} className="text-xs">
            {c.label}
          </ToneChip>
        ))}
      </div>
    </div>
  );
}

function RupeeInput({ value, onChange, placeholder, ...p }: { value: string; onChange: (v: string) => void; placeholder?: string } & Record<string, unknown>) {
  return (
    <InputGroup className="h-11 rounded-xl bg-card">
      <InputGroupAddon>
        <InputGroupText>₹</InputGroupText>
      </InputGroupAddon>
      <InputGroupInput {...p} className="text-base" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </InputGroup>
  );
}

// ---- Record payment --------------------------------------------------------------------------

export function PaymentDialog({ ticket, onClose, onDone }: Props) {
  return (
    <Shell ticket={ticket} onClose={onClose}>
      {(t) => <PaymentForm key={t.id} ticket={t} onClose={onClose} onDone={onDone} />}
    </Shell>
  );
}

function PaymentForm({ ticket, onClose, onDone }: { ticket: BoardTicket; onClose: () => void; onDone: () => void }) {
  const today = todayInIndia();
  const inv = ticket.invoice!;
  const [amountText, setAmountText] = useState("");
  const [tdsText, setTdsText] = useState("");
  const [paidOn, setPaidOn] = useState(today);
  const [mode, setMode] = useState<string>("BANK");
  const [reference, setReference] = useState("");
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  const amount = amountText.trim() ? parseRupees(amountText) : 0;
  const tds = tdsText.trim() ? parseRupees(tdsText) : 0;
  const leftAfter = amount !== null && tds !== null ? inv.leftPaise - amount - tds : null;
  const errors = {
    amount: amount === null ? "Please enter the amount in rupees, e.g. 4000 or 4000.50." : undefined,
    tds: tds === null ? "Please enter the TDS in rupees, e.g. 170." : undefined,
    both: amount !== null && tds !== null ? (paymentProblem(inv.leftPaise, amount, tds) ?? undefined) : undefined,
    paidOn: !paidOn ? "Please enter the payment date." : paidOn > today ? "The payment date can't be in the future." : undefined,
  };
  const hasErrors = Object.values(errors).some(Boolean);
  // Show "more than left" straight away; other problems after the first Save.
  const overpaid = errors.both && amount !== null && tds !== null && amount + tds > inv.leftPaise;

  async function save() {
    setTouched(true);
    if (hasErrors) return;
    setSaving(true);
    const r = await recordPaymentAction({ invoiceId: inv.id, amountPaise: amount!, tdsPaise: tds!, paidOn, mode: mode as "BANK", reference: reference.trim() || null });
    setSaving(false);
    if (!r.ok) return void toast.error(r.message);
    toast.success(
      r.data.paid
        ? `Invoice ${r.data.invoiceNumber} is paid in full. ${r.data.ticketCount === 1 ? "1 service" : `${r.data.ticketCount} services`} moved to Paid.`
        : `Payment saved. ${formatINR(r.data.leftPaise)} left on invoice ${r.data.invoiceNumber}.`,
    );
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
        <DialogTitle>Record payment</DialogTitle>
        <DialogDescription>{ticket.companyName}. Part payments are fine.</DialogDescription>
      </DialogHeader>
      <InvoiceSummary ticket={ticket} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Amount received" required error={touched || overpaid ? (errors.amount ?? (overpaid ? errors.both : touched ? errors.both : undefined)) : undefined}>
          {(p) => <RupeeInput {...p} value={amountText} onChange={setAmountText} placeholder={paiseToRupeeString(inv.leftPaise)} autoFocus />}
        </Field>
        <Field label="TDS deducted" optional helper="If the customer deducted TDS, e.g. 2% of the taxable value." error={touched ? errors.tds : undefined}>
          {(p) => <RupeeInput {...p} value={tdsText} onChange={setTdsText} placeholder="0" />}
        </Field>
        {!amountText && !tdsText ? (
          <Button type="button" variant="outline" size="sm" className="justify-self-start sm:col-span-2" onClick={() => setAmountText(paiseToRupeeString(inv.leftPaise))}>
            Full amount left ({formatINR(inv.leftPaise)})
          </Button>
        ) : null}
        <Field label="Payment date" required error={touched ? errors.paidOn : undefined}>
          {(p) => <Input {...p} type="date" value={paidOn} max={today} onChange={(e) => setPaidOn(e.target.value)} />}
        </Field>
        <Field label="Reference no." optional helper="UTR or cheque number.">
          {(p) => <Input {...p} value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} autoComplete="off" />}
        </Field>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-base font-medium">
          Mode <span className="text-destructive" aria-hidden>*</span>
        </legend>
        <RadioGroup value={mode} onValueChange={setMode} className="grid grid-cols-2 gap-2">
          {MODES.map((m) => (
            <Label key={m.value} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 font-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5">
              <RadioGroupItem value={m.value} />
              <span>
                {m.label}
                {"hint" in m ? <span className="block text-xs text-muted-foreground">{m.hint}</span> : null}
              </span>
            </Label>
          ))}
        </RadioGroup>
      </fieldset>

      {leftAfter !== null && leftAfter >= 0 && (amount! > 0 || tds! > 0) ? (
        <p className={`flex items-start gap-2 rounded-xl p-3 text-sm ${leftAfter === 0 ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200" : "bg-muted/50"}`} aria-live="polite">
          {leftAfter === 0 ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden /> : null}
          {leftAfter === 0
            ? `This clears the invoice. ${inv.ticketCount === 1 ? "The service moves" : `All ${inv.ticketCount} services move`} to Paid.`
            : `After this payment, ${formatINR(leftAfter)} will be left.`}
        </p>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Not now
        </Button>
        <Button type="submit" disabled={saving || !!overpaid}>
          {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          Save payment
        </Button>
      </DialogFooter>
    </form>
  );
}

// ---- Add follow-up note ------------------------------------------------------------------------

export function NoteDialog({ ticket, onClose, onDone }: Props) {
  return (
    <Shell ticket={ticket} onClose={onClose}>
      {(t) => <NoteForm key={t.id} ticket={t} onClose={onClose} onDone={onDone} />}
    </Shell>
  );
}

function NoteForm({ ticket, onClose, onDone }: { ticket: BoardTicket; onClose: () => void; onDone: () => void }) {
  const today = todayInIndia();
  const inv = ticket.invoice!;
  const [method, setMethod] = useState<string>("CALL");
  const [note, setNote] = useState("");
  const [promised, setPromised] = useState("");
  const [next, setNext] = useState("");
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const error = note.trim().length < 3 ? "Please write a short note, e.g. “Spoke to accounts, payment next week”." : undefined;

  async function save() {
    setTouched(true);
    if (error) return;
    setSaving(true);
    const r = await addFollowUpAction({ invoiceId: inv.id, method: method as "CALL", note: note.trim(), promisedDate: promised || null, nextFollowUpDate: next || null });
    setSaving(false);
    if (!r.ok) return void toast.error(r.message);
    toast.success(next ? `Note saved. Next follow-up on ${formatDate(next)}.` : "Note saved.");
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
        <DialogTitle>Add follow-up note</DialogTitle>
        <DialogDescription>
          {ticket.companyName}, invoice {inv.number}
          {inv.ticketCount > 1 ? ` (${inv.ticketCount} services)` : ""}. Shown on every service of this invoice.
        </DialogDescription>
      </DialogHeader>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-base font-medium">How</legend>
        <RadioGroup value={method} onValueChange={setMethod} className="flex flex-wrap gap-2">
          {METHODS.map((m) => (
            <Label key={m.value} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 font-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5">
              <RadioGroupItem value={m.value} />
              {m.label}
            </Label>
          ))}
        </RadioGroup>
      </fieldset>
      <Field label="Note" required error={touched ? error : undefined}>
        {(p) => <Textarea {...p} rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="e.g. Spoke to accounts, payment next week" autoFocus />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Customer promised payment by" optional>
          {(p) => <Input {...p} type="date" value={promised} onChange={(e) => setPromised(e.target.value)} />}
        </Field>
        <Field label="Next follow-up date" optional helper="The card shows “Follow-up due” on this day.">
          {(p) => <Input {...p} type="date" value={next} min={today} onChange={(e) => setNext(e.target.value)} />}
        </Field>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Not now
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          Save note
        </Button>
      </DialogFooter>
    </form>
  );
}

// ---- Send reminder ---------------------------------------------------------------------------

export function ReminderDialog({ ticket, onClose, onDone }: Props) {
  return (
    <Shell ticket={ticket} onClose={onClose}>
      {(t) => <ReminderBody key={t.id} ticket={t} onClose={onClose} onDone={onDone} />}
    </Shell>
  );
}

function ReminderBody({ ticket, onClose, onDone }: { ticket: BoardTicket; onClose: () => void; onDone: () => void }) {
  const [data, setData] = useState<(Reminder & { invoiceId: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    loadReminder(ticket.id).then((r) => {
      if (!live) return;
      if (r.ok) setData(r.data);
      else setError(r.message);
    });
    return () => {
      live = false;
    };
  }, [ticket.id]);

  // The link opens in a new tab; we note it on the timeline at the same moment.
  function logged(channel: "WHATSAPP" | "EMAIL") {
    if (!data) return;
    void logReminderAction(data.invoiceId, channel).then((r) => {
      if (!r.ok) return void toast.error(r.message);
      toast.success(`${channel === "WHATSAPP" ? "WhatsApp" : "Email"} reminder noted on the timeline.`);
      onDone();
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <DialogHeader>
        <DialogTitle>Send payment reminder</DialogTitle>
        <DialogDescription>
          Opens WhatsApp or your email app with a ready-written message to {ticket.contact.name}. You check it and press send yourself.
        </DialogDescription>
      </DialogHeader>
      <InvoiceSummary ticket={ticket} />

      {error ? <p className="text-sm font-medium text-destructive">{error}</p> : null}
      {!data && !error ? <Skeleton className="h-40 rounded-xl" /> : null}
      {data ? (
        <>
          <section className="flex flex-col gap-2">
            <h3 className="flex items-center gap-2 text-base font-medium">
              <MessageCircle className="size-4 text-emerald-600" aria-hidden /> WhatsApp to {data.phone}
            </h3>
            <p className="whitespace-pre-line rounded-xl border bg-card p-3 text-sm">{data.message}</p>
            {data.whatsappUrl ? (
              <Button asChild className="self-start bg-emerald-600 text-white hover:bg-emerald-700">
                <a href={data.whatsappUrl} target="_blank" rel="noopener" onClick={() => logged("WHATSAPP")}>
                  <MessageCircle aria-hidden /> Open WhatsApp
                </a>
              </Button>
            ) : (
              <p className="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                This mobile number doesn&apos;t look like an Indian mobile number. Please fix it in the customer&apos;s details.
              </p>
            )}
          </section>
          <section className="flex flex-col gap-2">
            <h3 className="flex items-center gap-2 text-base font-medium">
              <Mail className="size-4 text-primary" aria-hidden /> Email to {data.email}
            </h3>
            <div className="rounded-xl border bg-card p-3 text-sm">
              <p className="font-medium">{data.subject}</p>
              <p className="mt-2 line-clamp-4 whitespace-pre-line text-muted-foreground">{data.body}</p>
            </div>
            {data.mailtoUrl ? (
              <Button asChild variant="outline" className="self-start">
                <a href={data.mailtoUrl} onClick={() => logged("EMAIL")}>
                  <Mail aria-hidden /> Open email
                </a>
              </Button>
            ) : (
              <p className="text-sm text-amber-800 dark:text-amber-300">This email address doesn&apos;t look right. Please fix it in the customer&apos;s details.</p>
            )}
          </section>
          <p className="text-xs text-muted-foreground">The wording comes from Settings and can be changed there.</p>
        </>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Close
        </Button>
      </DialogFooter>
    </div>
  );
}
