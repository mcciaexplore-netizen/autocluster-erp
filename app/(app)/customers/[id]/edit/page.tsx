import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { FormSkeleton } from "@/components/common/form-skeleton";
import { PageHeader } from "@/components/common/page-header";
import { CustomerWizard } from "@/components/customers/customer-wizard";
import { toDetailsInput } from "@/lib/customer-form";
import { getCustomer, getDepartments, getServices, getSettings } from "@/lib/data";
import { toPricingSettings } from "@/lib/settings-shared";

/** Reads who is signed in (and stops with forbidden() when they may not see it), so it blocks on the server: no instant-navigation validation. */
export const instant = false;

export const metadata: Metadata = { title: "Edit customer" };

export default function EditCustomerPage({ params }: PageProps<"/customers/[id]/edit">) {
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Edit customer" description="Change any details, then save. Quotations already made will not change." />
      <Suspense fallback={<FormSkeleton />}>
        <Wizard params={params} />
      </Suspense>
    </div>
  );
}

async function Wizard({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [customer, departments, services, settings] = await Promise.all([
    getCustomer(id, { includeDrafts: true }),
    getDepartments(),
    getServices(),
    getSettings(),
  ]);
  if (!customer) notFound();
  return (
    <CustomerWizard
      departments={departments}
      services={services}
      pricing={toPricingSettings(settings)}
      initial={{ id: customer.id, details: toDetailsInput(customer), deptCodes: customer.deptCodes, serviceIds: customer.serviceIds }}
    />
  );
}
