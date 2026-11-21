import type { Metadata } from "next";
import { PageHeader } from "@/components/common/page-header";
import { ComingNext } from "@/components/inventory/coming-next";

export const metadata: Metadata = { title: "Jobs" };

export default function Page() {
  return (
    <div>
      <PageHeader title="Jobs" description="Every accepted service as a job: what's planned, running and done." />
      <ComingNext what="The jobs list is built in step 2." />
    </div>
  );
}
