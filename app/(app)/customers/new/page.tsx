import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { FormSkeleton } from "@/components/common/form-skeleton";
import { PageHeader } from "@/components/common/page-header";
import { CustomerWizard, type CustomerWizardProps } from "@/components/customers/customer-wizard";
import { getLeadDetail } from "@/lib/crm-data";
import { customerPrefillFromLead } from "@/lib/crm/convert";
import { getDepartments, getServices, getSettings } from "@/lib/data";
import { toPricingSettings } from "@/lib/settings-shared";

export const metadata: Metadata = { title: "Add new customer" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default function NewCustomerPage({ searchParams }: PageProps<"/customers/new">) {
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Add new customer" description="Three short steps. Your work is saved as you go." />
      <Suspense fallback={<FormSkeleton />}>
        <Wizard searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Wizard({ searchParams }: { searchParams: PageProps<"/customers/new">["searchParams"] }) {
  const sp = await searchParams;
  const leadId = one(sp.lead);
  const next = one(sp.next) === "quote" ? "quote" : null;
  const [departments, services, settings, lead] = await Promise.all([
    getDepartments(),
    getServices(),
    getSettings(),
    leadId && UUID.test(leadId) ? getLeadDetail(leadId) : Promise.resolve(null),
  ]);

  let fromLead: CustomerWizardProps["fromLead"];
  if (lead) {
    const l = lead.lead;
    // Already a customer: skip this step.
    if (lead.customer) redirect(next === "quote" ? `/quotations/new?customer=${lead.customer.id}&lead=${l.id}` : `/customers/${lead.customer.id}`);
    fromLead = {
      id: l.id,
      leadNo: l.leadNo,
      title: l.title,
      next,
      details: customerPrefillFromLead(l),
      deptCodes: lead.deptCodes,
      serviceIds: lead.services.map((s) => s.id),
    };
  }
  return (
    <CustomerWizard
      key={fromLead?.id ?? "new"}
      departments={departments}
      services={services}
      pricing={toPricingSettings(settings)}
      defaultCreditDays={settings.defaultCreditDays}
      fromLead={fromLead}
    />
  );
}
