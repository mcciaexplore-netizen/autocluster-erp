import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FileText, Plus, SearchX } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { ChipGroup, ClearFilters, SearchBox } from "@/components/common/filter-bar";
import { ListSkeleton } from "@/components/common/form-skeleton";
import { PageHeader } from "@/components/common/page-header";
import { DateRangeFilter } from "@/components/quotations/date-range";
import { QuotationList } from "@/components/quotations/quotation-list";
import { Button } from "@/components/ui/button";
import { listQuotations } from "@/lib/data";
import { formatINR, toPaise } from "@/lib/pricing";
import { QUOTE_STATUS, QUOTE_STATUSES } from "@/lib/labels";

export const metadata: Metadata = { title: "Quotations" };

export default function QuotationsPage({ searchParams }: PageProps<"/quotations">) {
  return (
    <>
      <PageHeader
        title="Quotations"
        description="Every quotation you have made."
        actions={
          <Button asChild size="lg">
            <Link href="/quotations/new">
              <Plus aria-hidden /> Create quotation
            </Link>
          </Button>
        }
      />
      <div className="mb-6 flex flex-col gap-4">
        <Suspense>
          <SearchBox label="Search quotations" placeholder="Search by quotation number or company" />
          <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center lg:gap-x-6">
            <ChipGroup label="Status" name="status" options={QUOTE_STATUSES.map((s) => ({ value: s, label: QUOTE_STATUS[s].label }))} />
            <DateRangeFilter />
            <ClearFilters keys={["q", "status", "from", "to"]} />
          </div>
        </Suspense>
      </div>
      <Suspense fallback={<ListSkeleton />}>
        <Results searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Results({ searchParams }: { searchParams: PageProps<"/quotations">["searchParams"] }) {
  const sp = await searchParams;
  const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const filters = { q: str(sp.q), status: str(sp.status), from: str(sp.from), to: str(sp.to) };
  const rows = await listQuotations(filters);
  if (!rows.length) {
    return Object.values(filters).some(Boolean) ? (
      <EmptyState icon={SearchX} title="No quotations match" description="Try a different search, or clear the filters." />
    ) : (
      <EmptyState
        icon={FileText}
        title="No quotations yet"
        description="Choose a customer, add services, and the prices are worked out for you."
        action={
          <Button asChild size="lg">
            <Link href="/quotations/new">
              <Plus aria-hidden /> Create your first quotation
            </Link>
          </Button>
        }
      />
    );
  }
  const totalPaise = rows.reduce((s, r) => s + toPaise(r.grandTotal), 0);
  return (
    <>
      <p className="mb-3 text-sm text-muted-foreground" aria-live="polite">
        Showing {rows.length} {rows.length === 1 ? "quotation" : "quotations"} · total {formatINR(totalPaise)}
      </p>
      <QuotationList rows={rows} />
    </>
  );
}
