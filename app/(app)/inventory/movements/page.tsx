import type { Metadata } from "next";
import { PageHeader } from "@/components/common/page-header";
import { ComingNext } from "@/components/inventory/coming-next";

export const metadata: Metadata = { title: "Stock in & out" };

export default function Page() {
  return (
    <div>
      <PageHeader title="Stock in & out" description="Every stock received, used and adjusted record." />
      <ComingNext what="Stock received, Use stock and Adjust stock are built in the next step." />
    </div>
  );
}
