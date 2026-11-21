"use client";

import {
  BellRing,
  CircleDot,
  FileText,
  FileUp,
  IndianRupee,
  Loader2,
  NotebookPen,
  PackageOpen,
  Receipt,
  RotateCcw,
  Undo2,
  XCircle,
  Download,
  FlaskConical,
  PackageMinus,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { DeptChip } from "@/components/common/badges";
import { JobChip } from "@/components/planning/job-chip";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { loadTicketDetail } from "@/lib/actions/orders";
import { formatDate, money } from "@/lib/format";
import type { BoardTicket, TicketDetail } from "@/lib/orders-data";
import { formatINR, toPaise } from "@/lib/pricing";
import { invoiceChips, todayInIndia } from "@/lib/tickets";
import { keptAfterMaterials } from "@/lib/inventory/materials";
import { formatQty } from "@/lib/inventory/numbers";
import { StageChip, ToneChip } from "./stage-chip";

const PAYMENT_MODES: Record<string, string> = { BANK: "Bank transfer", UPI: "UPI", CHEQUE: "Cheque", CASH: "Cash" };
const METHODS: Record<string, string> = { CALL: "Call", WHATSAPP: "WhatsApp", EMAIL: "Email", VISIT: "Visit", OTHER: "Other" };

const EVENT_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  OPENED: PackageOpen,
  REOPENED: RotateCcw,
  PO_ADDED: FileUp,
  BILLING_EXPORTED: Download,
  INVOICE_UPLOADED: Receipt,
  REMINDER_WHATSAPP: BellRing,
  REMINDER_EMAIL: BellRing,
  NOTE: NotebookPen,
  PAYMENT: IndianRupee,
  PAID: IndianRupee,
  MOVED_BACK: Undo2,
  CANCELLED: XCircle,
};

const dateTime = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

function FileLink({ file, label }: { file: { id: string; name: string; size: number } | null; label: string }) {
  if (!file) return <span className="text-sm text-muted-foreground">No {label.toLowerCase()} uploaded</span>;
  return (
    <a href={`/api/files/${file.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
      <FileText className="size-4" aria-hidden /> View {label} <span className="font-normal text-muted-foreground">({file.name}, {Math.max(1, Math.round(file.size / 1024))} KB)</span>
    </a>
  );
}

export function TicketPanel({
  ticket,
  open,
  onOpenChange,
  refreshKey,
  footer,
}: {
  ticket: BoardTicket | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Changes whenever the board data changes, so the panel reloads. */
  refreshKey: string;
  footer?: React.ReactNode;
}) {
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = ticket?.id;

  useEffect(() => {
    if (!open || !id) return;
    let live = true;
    loadTicketDetail(id).then((r) => {
      if (!live) return;
      if (r.ok) {
        setDetail(r.data);
        setError(null);
      } else setError(r.message);
    });
    return () => {
      live = false;
    };
  }, [open, id, refreshKey]);

  const d = detail && detail.ticket.id === id ? detail : null;
  const t = d?.ticket;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="gap-0 overflow-y-auto p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
        <SheetHeader className="border-b p-5">
          <SheetTitle className="flex flex-wrap items-center gap-2 tabular-nums">
            {ticket?.ticketNo} {ticket ? <StageChip stage={ticket.stage} /> : null}
          </SheetTitle>
          <SheetDescription>
            {ticket?.companyName} · {ticket?.description}
          </SheetDescription>
        </SheetHeader>

        {error ? <p className="m-5 rounded-xl bg-red-50 p-4 text-red-800">{error}</p> : null}
        {!d && !error ? (
          <div className="space-y-3 p-5" aria-busy="true">
            <Skeleton className="h-28 rounded-xl" />
            <Skeleton className="h-20 rounded-xl" />
            <Skeleton className="h-48 rounded-xl" />
          </div>
        ) : null}

        {d && t ? (
          <div className="flex flex-col gap-5 p-5">
            {footer ? <div className="flex flex-wrap gap-2">{footer}</div> : null}

            <section className="rounded-xl border p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                {t.snapshot.deptCode ? <DeptChip code={t.snapshot.deptCode} /> : null}
                <span className="font-semibold">{t.snapshot.description}</span>
                {t.snapshot.isCustomRate ? <ToneChip tone="amber" className="text-xs">custom rate</ToneChip> : null}
              </div>
              {t.snapshot.notes ? <p className="mb-2 text-sm text-muted-foreground">{t.snapshot.notes}</p> : null}
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Quantity</dt>
                <dd className="text-right">{t.snapshot.quantityText}</dd>
                <dt className="text-muted-foreground">List amount</dt>
                <dd className="text-right tabular-nums">{money(t.listAmount)}</dd>
                {Number(t.discountAmount) > 0 ? (
                  <>
                    <dt className="text-muted-foreground">Less: MCCIA member discount</dt>
                    <dd className="text-right tabular-nums">- {money(t.discountAmount)}</dd>
                  </>
                ) : null}
                <dt className="font-medium">Taxable value</dt>
                <dd className="text-right font-medium tabular-nums">{money(t.taxableValue)}</dd>
                {t.snapshot.intraState ? (
                  <>
                    <dt className="text-muted-foreground">CGST + SGST</dt>
                    <dd className="text-right tabular-nums">{formatINR(toPaise(t.cgst) + toPaise(t.sgst))}</dd>
                  </>
                ) : (
                  <>
                    <dt className="text-muted-foreground">IGST</dt>
                    <dd className="text-right tabular-nums">{money(t.igst)}</dd>
                  </>
                )}
                {Number(t.snapshot.roundOff) !== 0 ? (
                  <>
                    <dt className="text-muted-foreground">Round off (from the quotation)</dt>
                    <dd className="text-right tabular-nums">{money(t.snapshot.roundOff)}</dd>
                  </>
                ) : null}
                <div className="col-span-2 my-0.5 border-t" aria-hidden />
                <dt className="text-base font-semibold text-primary">Total</dt>
                <dd className="text-right text-base font-semibold text-primary tabular-nums">{money(t.totalAmount)}</dd>
              </dl>
              {d.quote ? (
                <p className="mt-3 text-sm">
                  From quotation{" "}
                  <Link href={`/quotations/${d.quote.id}`} className="font-medium text-primary hover:underline">
                    {d.quote.quoteNo}
                  </Link>
                </p>
              ) : null}
            </section>

            {ticket?.job && ticket.job.status !== "CANCELLED" ? (
              <section className="rounded-xl border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold">Job</h3>
                  <Link href={`/planning/jobs?job=${ticket.job.id}`} className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium hover:bg-secondary">
                    Open job
                  </Link>
                </div>
                <p className="mt-2 text-sm">
                  <JobChip job={ticket.job} />
                </p>
                {ticket.job.checkWorkDone ? <p className="mt-2 text-sm text-amber-900">Invoiced before planning started: check if work is done.</p> : null}
              </section>
            ) : null}

            <MaterialsSection ticketId={t.id} m={d.materials} cancelled={t.stage === "CANCELLED"} />

            {d.po ? (
              <section className="rounded-xl border p-4">
                <h3 className="mb-2 font-semibold">Purchase order</h3>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">PO no.</dt>
                  <dd>{d.po.number}</dd>
                  <dt className="text-muted-foreground">PO date</dt>
                  <dd>{formatDate(d.po.date)}</dd>
                  <dt className="text-muted-foreground">PO amount</dt>
                  <dd className="tabular-nums">{money(d.po.amount)}</dd>
                  {d.po.notes ? (
                    <>
                      <dt className="text-muted-foreground">Notes</dt>
                      <dd>{d.po.notes}</dd>
                    </>
                  ) : null}
                </dl>
                <div className="mt-2">
                  <FileLink file={d.po.file} label="PO" />
                </div>
              </section>
            ) : null}

            {d.invoice ? (
              <section className="rounded-xl border p-4">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold">Tax invoice {d.invoice.number}</h3>
                  {invoiceChips(d.invoice, todayInIndia()).map((c) => (
                    <ToneChip key={c.label} tone={c.tone} className="text-xs">
                      {c.label}
                    </ToneChip>
                  ))}
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">Invoice date</dt>
                  <dd>{formatDate(d.invoice.date)}</dd>
                  <dt className="text-muted-foreground">Due date</dt>
                  <dd>
                    {formatDate(d.invoice.dueDate)} ({d.invoice.creditDays} days credit)
                  </dd>
                  <dt className="text-muted-foreground">Invoice amount</dt>
                  <dd className="tabular-nums">{formatINR(d.invoice.amountPaise)}</dd>
                  <dt className="text-muted-foreground">Received</dt>
                  <dd className="tabular-nums">
                    {formatINR(d.invoice.paidPaise)}
                    {d.invoice.tdsPaise ? ` + TDS ${formatINR(d.invoice.tdsPaise)}` : ""}
                  </dd>
                  <dt className="font-medium">Amount left</dt>
                  <dd className="font-semibold text-primary tabular-nums">{formatINR(d.invoice.leftPaise)}</dd>
                  {d.invoice.ticketCount > 1 ? (
                    <>
                      <dt className="text-muted-foreground">Covers</dt>
                      <dd>{d.invoice.ticketCount} services</dd>
                    </>
                  ) : null}
                </dl>
                <div className="mt-2">
                  <FileLink file={d.invoice.file} label="invoice" />
                </div>
                {d.payments.length ? (
                  <div className="mt-3">
                    <h4 className="mb-1 text-sm font-semibold">Payments</h4>
                    <ul className="space-y-1 text-sm">
                      {d.payments.map((p) => (
                        <li key={p.id} className="flex flex-wrap justify-between gap-2">
                          <span>
                            {formatDate(p.paidOn)} · {PAYMENT_MODES[p.mode]}
                            {p.reference ? ` · ${p.reference}` : ""}
                          </span>
                          <span className="tabular-nums">
                            {money(p.amount)}
                            {Number(p.tdsAmount) ? ` + TDS ${money(p.tdsAmount)}` : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {d.notes.length ? (
                  <div className="mt-3">
                    <h4 className="mb-1 text-sm font-semibold">Follow-up notes</h4>
                    <ul className="space-y-2 text-sm">
                      {d.notes.map((n) => (
                        <li key={n.id} className="rounded-lg bg-secondary/60 p-2.5">
                          <span className="font-medium">{METHODS[n.method]}:</span> {n.note}
                          <span className="block text-xs text-muted-foreground">
                            {dateTime.format(new Date(n.createdAt))}
                            {n.promisedDate ? ` · promised by ${formatDate(n.promisedDate)}` : ""}
                            {n.nextFollowUpDate ? ` · next follow-up ${formatDate(n.nextFollowUpDate)}` : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </section>
            ) : null}

            <section>
              <h3 className="mb-3 font-semibold">Timeline</h3>
              <ol className="relative space-y-4 border-l pl-6">
                {d.events.map((e) => {
                  const Icon = EVENT_ICONS[e.type] ?? CircleDot;
                  return (
                    <li key={e.id} className="relative">
                      <span className="absolute top-0.5 -left-[2.05rem] grid size-6 place-items-center rounded-full border bg-card text-primary">
                        <Icon className="size-3.5" />
                      </span>
                      <p className="text-sm">{e.message}</p>
                      <p className="text-xs text-muted-foreground">
                        {dateTime.format(new Date(e.at))} · {e.by}
                      </p>
                    </li>
                  );
                })}
              </ol>
            </section>
          </div>
        ) : null}
        {!d && !error && ticket ? (
          <p className="sr-only" aria-live="polite">
            <Loader2 /> Loading
          </p>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/** Materials used for this job, the material cost, and "Kept after materials". */
function MaterialsSection({ ticketId, m, cancelled }: { ticketId: string; m: TicketDetail["materials"]; cancelled: boolean }) {
  const kept = keptAfterMaterials(m.taxablePaise, m.costPaise);
  return (
    <section className="rounded-xl border p-4" aria-labelledby={`mat-${ticketId}`}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 id={`mat-${ticketId}`} className="flex items-center gap-2 font-semibold">
          <FlaskConical className="size-4 text-primary" aria-hidden /> Materials used
        </h3>
        {!cancelled ? (
          <Link href={`/inventory/movements/new?type=out&ticket=${ticketId}`} className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium hover:bg-secondary">
            <PackageMinus className="size-4" aria-hidden /> Record materials
          </Link>
        ) : null}
      </div>
      {!m.recorded && m.hint ? (
        <p className={`mb-2 rounded-lg px-3 py-2 text-sm ${m.hint.ok ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>{m.hint.text}</p>
      ) : null}
      {m.items.length ? (
        <>
          <ul className="divide-y text-sm">
            {m.items.map((l) => (
              <li key={l.itemId} className="flex justify-between gap-3 py-1.5">
                <Link href={`/inventory/items/${l.itemId}`} className="min-w-0 hover:text-primary hover:underline">
                  {l.name}
                </Link>
                <span className="shrink-0 tabular-nums">
                  {formatQty(l.qty, l.unit)} · {formatINR(l.valuePaise)}
                </span>
              </li>
            ))}
          </ul>
          <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t pt-2 text-sm">
            <dt className="text-muted-foreground">Value before GST</dt>
            <dd className="text-right tabular-nums">{formatINR(m.taxablePaise)}</dd>
            <dt className="text-muted-foreground">Material cost</dt>
            <dd className="text-right tabular-nums">- {formatINR(m.costPaise)}</dd>
            <dt className="font-semibold">Kept after materials</dt>
            <dd className="text-right font-semibold tabular-nums">
              {formatINR(kept.keptPaise)}
              {kept.pct != null ? <span className="ml-1 font-normal text-muted-foreground">({kept.pct}%)</span> : null}
            </dd>
          </dl>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {m.hasList ? "Not recorded yet. “Record materials” fills in the suggested quantities." : m.noneNeeded ? "This service needs no materials." : "No materials recorded for this job."}
          </p>
          {!m.hasList ? (
            <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 border-t pt-2 text-sm">
              <dt className="font-semibold">Kept after materials</dt>
              {m.noneNeeded ? (
                <dd className="text-right font-semibold tabular-nums">
                  {formatINR(m.taxablePaise)} <span className="font-normal text-muted-foreground">(100%, no materials)</span>
                </dd>
              ) : (
                <dd className="text-right text-muted-foreground">No materials list</dd>
              )}
            </dl>
          ) : null}
        </>
      )}
    </section>
  );
}
