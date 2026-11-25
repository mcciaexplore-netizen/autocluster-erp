import type { Metadata } from "next";
import { Suspense } from "react";
import { FormSkeleton } from "@/components/common/form-skeleton";
import { PageHeader } from "@/components/common/page-header";
import { loadBuilderData } from "@/components/quotations/builder/load";
import { QuotationBuilder } from "@/components/quotations/builder/quotation-builder";
import { getLeadDetail } from "@/lib/crm-data";

/** Reads who is signed in (and stops with forbidden() when they may not see it), so it blocks on the server: no instant-navigation validation. */
export const instant = false;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  const rawLead = Array.isArray(sp.lead) ? sp.lead[0] : sp.lead;
  const [data, lead] = await Promise.all([loadBuilderData(), rawLead && UUID.test(rawLead) ? getLeadDetail(rawLead) : Promise.resolve(null)]);
  // From an enquiry: its customer is chosen (the enquiry is converted first if it had none).
  const leadCustomer = lead?.customer?.id ?? null;
  const want = leadCustomer ?? raw;
  const initialCustomerId = want && data.customers.some((c) => c.id === want) ? want : null;
  const fromLead =
    lead && initialCustomerId ? { id: lead.lead.id, leadNo: lead.lead.leadNo, title: lead.lead.title, serviceIds: lead.services.map((s) => s.id) } : null;
  return <QuotationBuilder {...data} key={fromLead?.id ?? "new"} initialCustomerId={initialCustomerId} existing={null} fromLead={fromLead} />;
}
