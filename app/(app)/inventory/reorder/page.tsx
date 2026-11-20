import type { Metadata } from "next";
import { PageHeader } from "@/components/common/page-header";
import { ComingNext } from "@/components/inventory/coming-next";

export const metadata: Metadata = { title: "Reorder list" };

export default function Page() {
  return (
    <div>
      <PageHeader title="Reorder list" description="What to order before it runs out." />
      <ComingNext what="The reorder list is built in step 5." />
    </div>
  );
}
