"use client";

import { ChevronUp } from "lucide-react";
import { useState } from "react";
import { formatINR, type Totals } from "@/lib/pricing";
import { cn } from "@/lib/utils";

function Rows({ totals, discountPct, priceLabel }: { totals: Totals; discountPct: number; priceLabel: string | null }) {
  const half = totals.gstPct / 2;
  const row = (label: string, value: number, opts: { muted?: boolean; bold?: boolean } = {}) => (
    <div className={cn("flex justify-between gap-4 py-1", opts.muted && "text-muted-foreground", opts.bold && "font-semibold")}>
      <dt>{label}</dt>
      <dd className="tabular-nums">
        {value < 0 ? "- " : ""}
        {formatINR(Math.abs(value))}
      </dd>
    </div>
  );
  return (
    <dl className="text-base">
      {row("Subtotal (list rates)", totals.subtotalPaise)}
      {totals.discountPaise > 0 ? row(`Less: MCCIA member discount (${discountPct}%)`, -totals.discountPaise, { muted: true }) : null}
      {row("Taxable value", totals.taxablePaise, { bold: true })}
      {totals.intraState ? (
        <>
          {row(`CGST ${half}%`, totals.cgstPaise, { muted: true })}
          {row(`SGST ${half}%`, totals.sgstPaise, { muted: true })}
        </>
      ) : (
        row(`IGST ${totals.gstPct}%`, totals.igstPaise, { muted: true })
      )}
      {totals.roundOffPaise !== 0 ? row("Round off", totals.roundOffPaise, { muted: true }) : null}
      <div className="mt-2 flex items-baseline justify-between gap-4 border-t pt-3">
        <dt className="text-lg font-semibold text-primary">Grand total</dt>
        <dd className="text-2xl font-semibold text-primary tabular-nums">{formatINR(totals.grandTotalPaise)}</dd>
      </div>
      <p className="mt-1 text-sm text-muted-foreground italic">{totals.amountInWords}</p>
      {priceLabel ? <p className="mt-3 rounded-lg bg-secondary px-3 py-2 text-sm text-primary">Price type: {priceLabel}</p> : null}
      <p className="mt-2 text-sm text-muted-foreground">
        {totals.intraState ? "Customer is in Maharashtra, so CGST + SGST apply." : "Customer is outside Maharashtra, so IGST applies."}
      </p>
    </dl>
  );
}

/** Desktop: sticky card on the right. */
export function LiveSummaryCard(props: { totals: Totals; discountPct: number; priceLabel: string | null; lineCount: number }) {
  return (
    <aside aria-label="Quotation summary" className="sticky top-24 rounded-2xl border bg-card p-6 shadow-sm">
      <h2 className="mb-3 text-lg font-semibold">Summary</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        {props.lineCount} {props.lineCount === 1 ? "service" : "services"} added
      </p>
      <Rows {...props} />
    </aside>
  );
}

/** Mobile: sticky bar above the bottom navigation, tap to see the breakdown. */
export function LiveSummaryBar(props: { totals: Totals; discountPct: number; priceLabel: string | null; lineCount: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="fixed inset-x-0 bottom-16 z-20 border-t bg-card shadow-[0_-4px_16px_rgba(11,31,58,0.08)] lg:hidden print:hidden">
      {open ? (
        <div className="max-h-[55dvh] overflow-y-auto px-4 pt-4">
          <Rows {...props} />
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex h-14 w-full items-center justify-between px-4"
      >
        <span className="text-sm text-muted-foreground">
          Grand total · {props.lineCount} {props.lineCount === 1 ? "service" : "services"}
        </span>
        <span className="flex items-center gap-2 text-xl font-semibold text-primary tabular-nums">
          {formatINR(props.totals.grandTotalPaise)}
          <ChevronUp className={cn("size-5 transition", open && "rotate-180")} aria-hidden />
        </span>
      </button>
    </div>
  );
}
