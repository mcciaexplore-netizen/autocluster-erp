import type { Metadata } from "next";
import { PageHeader } from "@/components/common/page-header";
import { ComingNext } from "@/components/inventory/coming-next";

export const metadata: Metadata = { title: "Planning insights" };

export default function Page() {
  return (
    <div>
      <PageHeader title="Planning insights" description="How busy each machine is, how much work is waiting, and quoted vs actual hours." />
      <ComingNext what="Insights are built in step 6." />
    </div>
  );
}
