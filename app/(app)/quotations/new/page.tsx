import type { Metadata } from "next";
import { Suspense } from "react";
import { FormSkeleton } from "@/components/common/form-skeleton";
import { PageHeader } from "@/components/common/page-header";
import { loadBuilderData } from "@/components/quotations/builder/load";
import { QuotationBuilder } from "@/components/quotations/builder/quotation-builder";

export const metadata: Metadata = { title: "Create quotation" };

export default function NewQuotationPage({ searchParams }: PageProps<"/quotations/new">) {
  return (
    <>
      <PageHeader title="Create quotation" description="Four short steps. Prices and taxes are worked out for you." />
      <Suspense fallback={<FormSkeleton />}>
        <Builder searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Builder({ searchParams }: { searchParams: PageProps<"/quotations/new">["searchParams"] }) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.customer) ? sp.customer[0] : sp.customer;
  const data = await loadBuilderData();
  const initialCustomerId = raw && data.customers.some((c) => c.id === raw) ? raw : null;
  return <QuotationBuilder {...data} initialCustomerId={initialCustomerId} existing={null} />;
}
