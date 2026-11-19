import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, Info } from "lucide-react";
import { StatusChip } from "@/components/common/badges";
import { QuotationDetailActions } from "@/components/quotations/detail-actions";
import { QuotationPaper } from "@/components/quotations/quotation-paper";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getQuotation, getSettings } from "@/lib/data";
import { formatDate, money } from "@/lib/format";
import { viewFromSaved } from "@/lib/quote-view";

export const metadata: Metadata = { title: "Quotation" };

export default function QuotationPage({ params, searchParams }: PageProps<"/quotations/[id]">) {
  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2 print:hidden">
        <Link href="/quotations">
          <ArrowLeft aria-hidden /> All quotations
        </Link>
      </Button>
      <Suspense fallback={<Skeletons />}>
        <Detail params={params} searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Detail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: PageProps<"/quotations/[id]">["searchParams"];
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const [q, settings] = await Promise.all([getQuotation(id), getSettings()]);
  if (!q) notFound();
  const view = viewFromSaved(q, settings);

  return (
    <>
      <div className="mb-6 flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between print:hidden">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-title text-3xl text-primary tabular-nums md:text-4xl">{q.quoteNo}</h1>
            <StatusChip status={q.status} />
          </div>
          <p className="mt-2 text-lg">
            <Link href={`/customers/${q.customerId}`} className="font-medium text-primary hover:underline">
              {q.customerSnapshot.companyName}
            </Link>
          </p>
          <p className="text-muted-foreground">
            {formatDate(q.quoteDate)} · valid until {formatDate(q.validUntil)} · <strong className="text-foreground">{money(q.grandTotal)}</strong>
          </p>
        </div>
        <QuotationDetailActions id={q.id} status={q.status} autoPrint={sp.print === "1"} />
      </div>
      <p className="mb-4 flex items-start gap-2 text-sm text-muted-foreground print:hidden">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        Customer details and rates were saved with this quotation, so later changes to the customer or the rate card do not affect it.
      </p>
      <QuotationPaper view={view} />
    </>
  );
}

function Skeletons() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-10 w-80" />
      <Skeleton className="h-6 w-60" />
      <Skeleton className="h-[60rem] w-full rounded-xl" />
    </div>
  );
}
