"use client";

import { AlertTriangle, Link2, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Field } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Textarea } from "@/components/ui/textarea";
import type { ExistingPo } from "@/db/po-writer";
import { addPoAction, checkPoNumber } from "@/lib/actions/orders";
import type { BlobEnv, UploadedFile } from "@/lib/files";
import { formatDate } from "@/lib/format";
import type { BoardTicket } from "@/lib/orders-data";
import { parseRupees } from "@/lib/money-input";
import { formatINR } from "@/lib/pricing";
import { poAmountMatches, todayInIndia } from "@/lib/tickets";
import { FileField } from "./file-field";
import { groupTickets, ServiceChecklist, useToggleSet } from "./service-checklist";

export function AddPoDialog({
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
        {ticket ? <AddPoForm key={ticket.id} ticket={ticket} tickets={tickets} env={env} onClose={onClose} onDone={onDone} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function AddPoForm({
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

  // Same customer's tickets still waiting for a PO, grouped by quotation.
  const candidates = useMemo(
    () => tickets.filter((t) => t.customerId === ticket.customerId && t.stage === "WAITING_PO"),
    [tickets, ticket.customerId],
  );
  const groups = useMemo(
    () => groupTickets(candidates, (t) => t.quotationId, (t) => `Quotation ${t.quoteNo}`, ticket.quotationId),
    [candidates, ticket.quotationId],
  );

  const [selected, setSelected] = useState<Set<string>>(
    () => new Set([ticket.id, ...candidates.filter((t) => t.quotationId === ticket.quotationId).map((t) => t.id)]),
  );
  const [poNumber, setPoNumber] = useState("");
  const [poDate, setPoDate] = useState(today);
  const [amountText, setAmountText] = useState("");
  const [file, setFile] = useState<UploadedFile | null>(null);
  const [uploading, setUploading] = useState(false);
  const [notes, setNotes] = useState("");
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [duplicate, setDuplicate] = useState<ExistingPo | null>(null);
  const [linkTo, setLinkTo] = useState<ExistingPo | null>(null);

  // Warn as soon as the customer already has this PO number.
  useEffect(() => {
    const no = poNumber.trim();
    if (!no || linkTo) return;
    let stale = false;
    const t = setTimeout(async () => {
      const r = await checkPoNumber(ticket.customerId, no);
      if (!stale && r.ok) setDuplicate(r.data);
    }, 350);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [poNumber, ticket.customerId, linkTo]);
  const shownDuplicate = poNumber.trim() && duplicate && duplicate.number.toLowerCase() === poNumber.trim().replace(/\s+/g, " ").toLowerCase() ? duplicate : null;

  const chosen = candidates.filter((t) => selected.has(t.id));
  const beforeGst = chosen.reduce((s, t) => s + (t.taxablePaise ?? 0), 0);
  const withGst = chosen.reduce((s, t) => s + (t.totalPaise ?? 0), 0);
  const poPaise = linkTo ? linkTo.amountPaise : parseRupees(amountText);

  const errors = linkTo
    ? {}
    : {
        poNumber: !poNumber.trim() ? "Please enter the PO number, e.g. 4500012345." : undefined,
        poDate: !poDate ? "Please enter the PO date." : poDate > today ? "The PO date can't be in the future." : undefined,
        amount: !amountText.trim()
          ? "Please enter the PO amount, e.g. 8496."
          : poPaise === null || poPaise <= 0
            ? "Please enter the amount in rupees, e.g. 8496 or 8496.50."
            : undefined,
      };
  const hasErrors = Object.values(errors).some(Boolean);

  const toggle = useToggleSet(setSelected);

  async function save() {
    setTouched(true);
    if (hasErrors || uploading) return;
    setSaving(true);
    const ticketIds = chosen.map((t) => t.id);
    const r = await addPoAction(
      linkTo
        ? { ticketIds, existingPoId: linkTo.id }
        : {
            ticketIds,
            poNumber: poNumber.trim(),
            poDate,
            poAmountPaise: poPaise!,
            fileId: file?.id ?? null,
            notes: notes.trim() || null,
          },
    );
    setSaving(false);
    if (!r.ok) {
      if (r.duplicate) setDuplicate(r.duplicate);
      toast.error(r.message);
      return;
    }
    const n = r.data.moved.length;
    toast.success(`PO ${r.data.poNumber} saved. ${n === 1 ? "1 service" : `${n} services`} moved to Billing.`);
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
        <DialogTitle>Add PO</DialogTitle>
        <DialogDescription>
          {ticket.companyName}. Saving moves the ticked services to <strong>Billing</strong>.
        </DialogDescription>
      </DialogHeader>

      {linkTo ? (
        <div className="flex flex-col gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm">
          <p className="flex items-center gap-2 font-medium">
            <Link2 className="size-4 text-primary" aria-hidden />
            Linking to PO {linkTo.number}
          </p>
          <p className="text-muted-foreground">
            Dated {formatDate(linkTo.date)}, {formatINR(linkTo.amountPaise)}
            {linkTo.ticketNos.length ? `. Already used for ${linkTo.ticketNos.join(", ")}.` : "."}
          </p>
          <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setLinkTo(null)}>
            Enter a different PO instead
          </Button>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="PO number" required helper="As printed on the customer's PO." error={touched ? errors.poNumber : undefined} className="sm:col-span-2">
              {(p) => <Input {...p} value={poNumber} onChange={(e) => setPoNumber(e.target.value)} maxLength={60} autoComplete="off" autoFocus />}
            </Field>
            {shownDuplicate ? (
              <div role="status" className="flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 sm:col-span-2 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                <p className="flex items-start gap-2 font-medium">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                  {ticket.companyName} already has PO {shownDuplicate.number}
                </p>
                <p>
                  Dated {formatDate(shownDuplicate.date)}, {formatINR(shownDuplicate.amountPaise)}
                  {shownDuplicate.ticketNos.length ? `, used for ${shownDuplicate.ticketNos.join(", ")}` : ""}. If it&apos;s the same PO, link these services to it.
                </p>
                <Button type="button" size="sm" className="self-start" onClick={() => setLinkTo(shownDuplicate)}>
                  <Link2 className="size-4" aria-hidden /> Link to PO {shownDuplicate.number}
                </Button>
              </div>
            ) : null}
            <Field label="PO date" required error={touched ? errors.poDate : undefined}>
              {(p) => <Input {...p} type="date" value={poDate} max={today} onChange={(e) => setPoDate(e.target.value)} />}
            </Field>
            <Field label="PO amount" required helper="Before or after GST, as on the PO." error={touched ? errors.amount : undefined}>
              {(p) => (
                <InputGroup className="h-11 rounded-xl bg-card">
                  <InputGroupAddon>
                    <InputGroupText>₹</InputGroupText>
                  </InputGroupAddon>
                  <InputGroupInput {...p} className="text-base" inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder="8496" />
                </InputGroup>
              )}
            </Field>
          </div>
          <Field label="PO copy (recommended)" helper="So anyone can check the PO later.">
            {(p) => (
              <FileField id={p.id} describedBy={p["aria-describedby"]} kind="PO" env={env} value={file} onChange={setFile} onBusyChange={setUploading} />
            )}
          </Field>
          <Field label="Notes" optional>
            {(p) => <Textarea {...p} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} placeholder="e.g. PO received by email from purchase team" />}
          </Field>
        </>
      )}

      <ServiceChecklist legend="This PO also covers" groups={groups} selected={selected} selfId={ticket.id} onToggle={toggle} />

      <div className="flex flex-col gap-2 rounded-xl bg-muted/50 p-3 text-sm" aria-live="polite">
        <p>
          PO amount <strong className="tabular-nums">{poPaise ? formatINR(poPaise) : "–"}</strong>. Selected services:{" "}
          <strong className="tabular-nums">{formatINR(beforeGst)}</strong> before GST, <strong className="tabular-nums">{formatINR(withGst)}</strong> with GST.
        </p>
        {poPaise && poPaise > 0 && !poAmountMatches(poPaise, beforeGst, withGst) ? (
          <p className="flex items-start gap-2 font-medium text-amber-800 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            PO amount doesn&apos;t match the quotation. Please check before billing.
          </p>
        ) : null}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Not now
        </Button>
        <Button type="submit" disabled={saving || uploading}>
          {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {linkTo ? "Link PO and move to Billing" : "Save PO and move to Billing"}
        </Button>
      </DialogFooter>
    </form>
  );
}
