import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/common/page-header";
import { CrmList } from "@/components/crm/crm-list";
import { getBoardLeads, getCrmPickers, getCrmStages } from "@/lib/crm-data";
import { boardStage, CrmSkeleton } from "@/components/crm/crm-skeleton";

export const metadata: Metadata = { title: "Enquiries (list)" };

export default function CrmListPage() {
  return (
    <div>
      <PageHeader title="Enquiries" description="Every enquiry in one table. Tick some to change them together." />
      <Suspense fallback={<CrmSkeleton />}>
        <List />
      </Suspense>
    </div>
  );
}

async function List() {
  const [stages, leads, pickers] = await Promise.all([getCrmStages(), getBoardLeads(), getCrmPickers()]);
  return <CrmList stages={stages.map(boardStage)} leads={leads} pickers={pickers} />;
}
