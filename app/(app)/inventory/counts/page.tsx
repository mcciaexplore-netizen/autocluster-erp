import type { Metadata } from "next";
import { PageHeader } from "@/components/common/page-header";
import { ComingNext } from "@/components/inventory/coming-next";

export const metadata: Metadata = { title: "Stock count" };

export default function Page() {
  return (
    <div>
      <PageHeader title="Stock count" description="Count what is on the shelves and correct the stock." />
      <ComingNext what="Stock counts are built in step 4." />
    </div>
  );
}
