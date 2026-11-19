import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { FormSkeleton } from "@/components/common/form-skeleton";
import { PageHeader } from "@/components/common/page-header";
import { loadBuilderData } from "@/components/quotations/builder/load";
import { QuotationBuilder } from "@/components/quotations/builder/quotation-builder";
import { getQuotation } from "@/lib/data";
import { itemToDraft } from "@/lib/quote-items";

export const metadata: Metadata = { title: "Edit quotation" };

export default function EditQuotationPage({ params }: PageProps<"/quotations/[id]/edit">) {
  return (
    <>
      <PageHeader title="Edit quotation" description="Rates saved on this quotation stay the same unless you change them." />
      <Suspense fallback={<FormSkeleton />}>
        <Builder params={params} />
      </Suspense>
    </>
  );
}

async function Builder({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [q, data] = await Promise.all([getQuotation(id), loadBuilderData()]);
  if (!q) notFound();
  // If the customer was deleted since, keep the quotation editable using its saved details.
  const customers = data.customers.some((c) => c.id === q.customerId)
    ? data.customers
    : [...data.customers, { ...q.customerSnapshot, tan: null, udyamNo: null, deptCodes: [], serviceIds: [] }];
  return (
    <QuotationBuilder
      {...data}
      customers={customers}
      initialCustomerId={q.customerId}
      existing={{
        id: q.id,
        quoteNo: q.quoteNo,
        status: q.status,
        customerId: q.customerId,
        quoteDate: q.quoteDate,
        validUntil: q.validUntil,
        subject: q.subject,
        notes: q.notes,
        terms: q.terms,
        lines: q.items.map(itemToDraft),
      }}
    />
  );
}
