import type { Metadata } from "next";
import { ArrowLeft, FileText } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { FormSkeleton } from "@/components/common/form-skeleton";
import { DocTypeChip } from "@/components/inventory/doc-type";
import { ReverseButton } from "@/components/inventory/reverse-button";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { getInvDocument, getInvLists } from "@/lib/inventory-data";
import { formatQty, formatRate } from "@/lib/inventory/numbers";
import { UUID_RE } from "@/lib/inventory/uuid";
import { formatINR } from "@/lib/pricing";

export const metadata: Metadata = { title: "Stock record" };

export default function DocPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2">
        <Link href="/inventory/movements">
          <ArrowLeft aria-hidden /> Stock in &amp; out
        </Link>
      </Button>
      <Suspense fallback={<FormSkeleton />}>
        <Detail params={params} />
      </Suspense>
    </div>
  );
}

async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const [d, lists] = await Promise.all([getInvDocument(id), getInvLists()]);
  if (!d) notFound();
  const total = d.lines.reduce((a, l) => a + (Number(l.qtyIn) > 0 ? l.value : -l.value), 0);
  const canReverse = !d.reverses && !d.reversedBy;
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-title text-3xl text-primary tabular-nums md:text-4xl">{d.docNo}</h1>
            <DocTypeChip type={d.type} reversal={!!d.reverses} />
          </div>
          <p className="mt-2 text-muted-foreground">
            {formatDate(d.docDate)}
            {d.doneBy ? ` · by ${d.doneBy}` : ""}
          </p>
        </div>
        {canReverse ? <ReverseButton docId={d.id} docNo={d.docNo} team={lists.team.filter((t) => t.isActive)} /> : null}
      </header>

      {d.reverses && d.reversesDocId ? (
        <p className="rounded-xl border bg-secondary p-3 text-sm">
          This record reverses{" "}
          <Link href={`/inventory/movements/${d.reversesDocId}`} className="font-medium text-primary hover:underline">
            {d.reverses}
          </Link>
          .
        </p>
      ) : null}
      {d.reversedBy && d.reversedByDocId ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          This record was reversed by{" "}
          <Link href={`/inventory/movements/${d.reversedByDocId}`} className="font-medium underline">
            {d.reversedBy}
          </Link>
          , so it no longer counts.
        </p>
      ) : null}

      <section className="rounded-2xl border bg-card p-5 text-sm">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-[auto_1fr]">
          {d.supplier ? (
            <>
              <dt className="text-muted-foreground">Supplier</dt>
              <dd>{d.supplier}</dd>
            </>
          ) : null}
          {d.billNo || d.supplierBillDate ? (
            <>
              <dt className="text-muted-foreground">Supplier bill</dt>
              <dd>
                {d.billNo ?? "No number"}
                {d.supplierBillDate ? ` dated ${formatDate(d.supplierBillDate)}` : ""}
              </dd>
            </>
          ) : null}
          {d.fileId ? (
            <>
              <dt className="text-muted-foreground">Bill copy</dt>
              <dd>
                <a href={`/api/files/${d.fileId}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline">
                  <FileText className="size-4" aria-hidden /> View bill
                </a>
              </dd>
            </>
          ) : null}
          {d.ticketNo ? (
            <>
              <dt className="text-muted-foreground">Job</dt>
              <dd>
                <Link href={`/orders?ticket=${d.ticketId}`} className="font-medium text-primary hover:underline">
                  {d.ticketNo}
                </Link>
                {d.ticketCompany ? `, ${d.ticketCompany}` : ""}
              </dd>
            </>
          ) : null}
          {d.purpose ? (
            <>
              <dt className="text-muted-foreground">Used for</dt>
              <dd>{d.purpose}</dd>
            </>
          ) : null}
          {d.note ? (
            <>
              <dt className="text-muted-foreground">Note</dt>
              <dd className="whitespace-pre-wrap">{d.note}</dd>
            </>
          ) : null}
        </dl>
      </section>

      <section className="overflow-x-auto rounded-2xl border bg-card">
        <table className="w-full text-sm">
          <caption className="sr-only">Lines</caption>
          <thead className="border-b bg-secondary/50 text-left text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-medium">Item</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Batch</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">Quantity</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">Cost per unit</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">Value</th>
            </tr>
          </thead>
          <tbody>
            {d.lines.map((l) => {
              const inn = Number(l.qtyIn) > 0;
              return (
                <tr key={l.id} className="border-b last:border-0">
                  <td className="px-4 py-2.5">
                    <Link href={`/inventory/items/${l.itemId}`} className="font-medium hover:text-primary hover:underline">
                      {l.itemName}
                    </Link>
                    <span className="block text-xs text-muted-foreground">
                      {l.itemCode}
                      {l.reason ? ` · ${l.reason}` : ""}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">{l.batchNo ? `${l.batchNo}${l.expiryDate ? `, exp. ${formatDate(l.expiryDate)}` : ""}` : "—"}</td>
                  <td className={`px-4 py-2.5 text-right font-medium whitespace-nowrap tabular-nums ${inn ? "text-emerald-700" : "text-red-700"}`}>
                    {inn ? "+" : "−"}
                    {formatQty(inn ? l.qtyIn : l.qtyOut, l.unit)}
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">{formatRate(l.unitCost)}</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">{formatINR(l.value)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t bg-secondary/30">
              <td colSpan={4} className="px-4 py-2.5 text-right font-medium">
                {d.type === "IN" ? "Total before GST" : "Total value"}
              </td>
              <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{formatINR(Math.abs(total))}</td>
            </tr>
          </tfoot>
        </table>
      </section>
      {!canReverse ? null : <p className="text-sm text-muted-foreground">To fix a mistake, reverse it and enter it again.</p>}
    </div>
  );
}
