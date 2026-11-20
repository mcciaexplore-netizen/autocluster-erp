import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/common/page-header";
import { CrmBoard } from "@/components/crm/crm-board";
import { boardStage, CrmSkeleton } from "@/components/crm/crm-skeleton";
import { canManagePipeline } from "@/lib/crm/permissions";
import { getBoardLeads, getCrmStages, getLeadFormOptions } from "@/lib/crm-data";

export const metadata: Metadata = { title: "Enquiries" };

export default function CrmPage() {
  return (
    <div>
      <PageHeader
        title="Enquiries"
        description={
          <>
            Every enquiry, from first contact until it is won or lost.<span className="hidden lg:inline"> Drag a card to move it to another stage.</span>
          </>
        }
      />
      <Suspense fallback={<CrmSkeleton />}>
        <Board />
      </Suspense>
    </div>
  );
}

async function Board() {
  const [stages, leads, options, canManage] = await Promise.all([getCrmStages(), getBoardLeads(), getLeadFormOptions(), canManagePipeline()]);
  return <CrmBoard stages={stages.map(boardStage)} leads={leads} options={options} canManage={canManage} />;
}
