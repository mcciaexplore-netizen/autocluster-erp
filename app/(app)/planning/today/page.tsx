import type { Metadata } from "next";
import { PageHeader } from "@/components/common/page-header";
import { ComingNext } from "@/components/inventory/coming-next";

export const metadata: Metadata = { title: "Today" };

export default function Page() {
  return (
    <div>
      <PageHeader title="Today" description="Your jobs for today: start, pause and finish them from your phone." />
      <ComingNext what="Today for operators is built in step 4." />
    </div>
  );
}
