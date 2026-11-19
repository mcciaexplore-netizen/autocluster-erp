import type { Metadata } from "next";
import { Suspense } from "react";
import { FormSkeleton } from "@/components/common/form-skeleton";
import { PageHeader } from "@/components/common/page-header";
import { CustomerWizard } from "@/components/customers/customer-wizard";
import { getDepartments, getServices, getSettings } from "@/lib/data";
import { toPricingSettings } from "@/lib/settings-shared";

export const metadata: Metadata = { title: "Add new customer" };

export default function NewCustomerPage() {
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Add new customer" description="Three short steps. Your work is saved as you go." />
      <Suspense fallback={<FormSkeleton />}>
        <Wizard />
      </Suspense>
    </div>
  );
}

async function Wizard() {
  const [departments, services, settings] = await Promise.all([getDepartments(), getServices(), getSettings()]);
  return <CustomerWizard departments={departments} services={services} pricing={toPricingSettings(settings)} />;
}
