import type { Metadata } from "next";
import { Suspense } from "react";
import { ListSkeleton } from "@/components/common/form-skeleton";
import { PageHeader } from "@/components/common/page-header";
import { RateCardEditor } from "@/components/rate-card/rate-card-editor";
import { getDepartments, getServices } from "@/lib/data";

export const metadata: Metadata = { title: "Rate Card" };

export default function RateCardPage() {
  return (
    <>
      <PageHeader title="Rate Card" description="Standard charges for every service, in rupees, before GST." />
      <Suspense fallback={<ListSkeleton rows={8} />}>
        <RateCard />
      </Suspense>
    </>
  );
}

async function RateCard() {
  const [departments, services] = await Promise.all([getDepartments(), getServices()]);
  return <RateCardEditor departments={departments} services={services} />;
}
