import type { Metadata } from "next";
import { ArrowLeftRight, Paperclip } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { EmptyState } from "@/components/common/empty-state";
import { ListSkeleton } from "@/components/common/form-skeleton";
import { PageHeader } from "@/components/common/page-header";
import { DocTypeChip } from "@/components/inventory/doc-type";
import { MovementsFilters } from "@/components/inventory/movements-filters";
import { QuickActions } from "@/components/inventory/quick-actions";
import { formatDate } from "@/lib/format";
import { docFiltersFromParams, getStockFormData, listInvDocuments, listInvItems } from "@/lib/inventory-data";
import { formatINRShort } from "@/lib/pricing";
import { cn } from "@/lib/utils";

/** Reads who is signed in (and stops with forbidden() when they may not see it), so it blocks on the server: no instant-navigation validation. */
export const instant = false;

export const metadata: Metadata = { title: "Stock in & out" };

type Sp = Promise<Record<string, string | string[] | undefined>>;

export default function MovementsPage({ searchParams }: { searchParams: Sp }) {
  return (
    <div>
      <PageHeader title="Stock in & out" description="Every stock received, used and adjusted record, newest first. To fix a mistake, reverse it and enter it again." />
      <QuickActions className="mb-6" />
      <Suspense fallback={<ListSkeleton rows={6} />}>
        <List searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

function what(d: Awaited<ReturnType<typeof listInvDocuments>>[number]) {
  if (d.type === "IN") return [d.supplier, d.billNo ? `bill ${d.billNo}` : null].filter(Boolean).join(", ");
  if (d.type === "OUT") return d.ticketNo ? `Job ${d.ticketNo}${d.ticketCompany ? `, ${d.ticketCompany}` : ""}` : (d.purpose ?? "");
  return d.note ?? "";
}

async function List({ searchParams }: { searchParams: Sp }) {
  const f = docFiltersFromParams(await searchParams);
  const [docs, items, form] = await Promise.all([listInvDocuments(f), listInvItems(), getStockFormData()]);
  const ticketLabel = f.ticket ? (docs.find((d) => d.ticketId === f.ticket)?.ticketNo ?? null) : null;
  return (
    <>
      <MovementsFilters items={items.map((i) => ({ id: i.id, name: i.name }))} suppliers={form.suppliers} team={form.team} ticketLabel={ticketLabel} />
      {!docs.length ? (
        <EmptyState icon={ArrowLeftRight} title="No records here" description="Records appear when stock is received, used or adjusted." />
      ) : (
        <ul className="divide-y rounded-2xl border bg-card">
          {docs.map((d) => {
            const value = d.type === "IN" || (d.type === "ADJ" && d.valueInPaise >= d.valueOutPaise) ? d.valueInPaise - d.valueOutPaise : d.valueOutPaise - d.valueInPaise;
            return (
              <li key={d.id}>
                <Link href={`/inventory/movements/${d.id}`} className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3.5 hover:bg-secondary/60 sm:px-5", d.reversedBy && "opacity-70")}>
                  <span className="w-24 shrink-0 text-sm text-muted-foreground">{formatDate(d.docDate)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-primary tabular-nums">{d.docNo}</span>
                      <DocTypeChip type={d.type} reversal={!!d.reverses} />
                      {d.reversedBy ? <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">Reversed by {d.reversedBy}</span> : null}
                      {d.hasBill ? <Paperclip className="size-4 text-muted-foreground" aria-label="Bill attached" /> : null}
                    </span>
                    <span className="block truncate text-sm text-muted-foreground">
                      {[what(d), d.items].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className="text-sm text-muted-foreground">{d.doneBy ?? ""}</span>
                  <span className="w-28 text-right font-semibold tabular-nums">{formatINRShort(Math.abs(value))}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-sm text-muted-foreground">
        {docs.length} {docs.length === 1 ? "record" : "records"}
        {docs.length >= 300 ? " (the newest 300; narrow the dates to see older ones)" : ""}.
      </p>
    </>
  );
}
