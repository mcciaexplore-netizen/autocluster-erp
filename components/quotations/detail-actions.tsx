"use client";

import { Copy, Download, Pencil, Printer } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { QUOTE_STATUS, QUOTE_STATUSES, type QuoteStatus } from "@/lib/labels";
import { useQuotationActions } from "./row-actions";

export function QuotationDetailActions({ id, status, autoPrint, locked }: { id: string; status: QuoteStatus; autoPrint: boolean; locked: boolean }) {
  const { pending, duplicate, changeStatus, dialog } = useQuotationActions(id);

  useEffect(() => {
    if (!autoPrint) return;
    const t = setTimeout(() => window.print(), 600);
    // Remove ?print=1 so a refresh does not print again.
    window.history.replaceState(null, "", window.location.pathname);
    return () => clearTimeout(t);
  }, [autoPrint]);

  return (
    <div className="flex flex-col gap-3 print:hidden">
      {dialog}
      <div className="flex flex-wrap gap-3">
        <Button asChild size="lg">
          <a href={`/quotations/${id}/pdf?download=1`} download>
            <Download aria-hidden /> Download PDF
          </a>
        </Button>
        <Button variant="outline" size="lg" onClick={() => window.print()}>
          <Printer aria-hidden /> Print
        </Button>
        {locked ? null : (
          <Button asChild variant="outline" size="lg">
            <Link href={`/quotations/${id}/edit`}>
              <Pencil aria-hidden /> Edit
            </Link>
          </Button>
        )}
        <Button variant="outline" size="lg" onClick={duplicate} disabled={pending}>
          <Copy aria-hidden /> {locked ? "Duplicate as revised quotation" : "Duplicate"}
        </Button>
      </div>
      <div className="flex items-center gap-3">
        <label htmlFor="status" className="font-medium">
          Status
        </label>
        <Select value={status} onValueChange={(v) => v !== status && changeStatus(v as QuoteStatus)} disabled={pending}>
          <SelectTrigger id="status" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {QUOTE_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {QUOTE_STATUS[s].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
