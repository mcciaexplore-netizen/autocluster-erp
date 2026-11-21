import type { Metadata } from "next";
import { PageHeader } from "@/components/common/page-header";
import { ComingNext } from "@/components/inventory/coming-next";

export const metadata: Metadata = { title: "Machine timeline" };

export default function Page() {
  return (
    <div>
      <PageHeader title="Machine timeline" description="Every machine's bookings over time. Drag jobs onto machines to book them." />
      <ComingNext what="The machine timeline is built in step 3." />
    </div>
  );
}
