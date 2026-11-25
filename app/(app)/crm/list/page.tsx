import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/common/page-header";
import { CrmList } from "@/components/crm/crm-list";
import { getBoardLeads, getCrmStages, getLeadFormOptions } from "@/lib/crm-data";
import { boardStage, CrmSkeleton } from "@/components/crm/crm-skeleton";

/** Reads who is signed in (and stops with forbidden() when they may not see it), so it blocks on the server: no instant-navigation validation. */
export const instant = false;

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
  const [stages, leads, options] = await Promise.all([getCrmStages(), getBoardLeads(), getLeadFormOptions()]);
  return <CrmList stages={stages.map(boardStage)} leads={leads} options={options} />;
}
