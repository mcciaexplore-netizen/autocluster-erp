import type { Metadata } from "next";
import { PageHeader } from "@/components/common/page-header";
import { ComingNext } from "@/components/inventory/coming-next";

export const metadata: Metadata = { title: "Insights" };

export default function Page() {
  return (
    <div>
      <PageHeader title="Insights" description="Material costs, margins, stock value and price changes." />
      <ComingNext what="Insights are built in step 6." />
    </div>
  );
}
