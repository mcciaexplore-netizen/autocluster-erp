import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { FormSkeleton } from "@/components/common/form-skeleton";
import { PageHeader } from "@/components/common/page-header";
import { MachineForm } from "@/components/planning/machine-form";
import { Button } from "@/components/ui/button";
import { getMachineFormOptions } from "@/lib/planning-data";
import { EMPTY_MACHINE_FORM } from "@/lib/validation/planning";

export const metadata: Metadata = { title: "Add machine" };

export default function Page() {
  return (
    <div className="mx-auto max-w-4xl">
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2">
        <Link href="/planning/machines">
          <ArrowLeft aria-hidden /> Machines
        </Link>
      </Button>
      <PageHeader title="Add machine" />
      <Suspense fallback={<FormSkeleton />}>
        <Body />
      </Suspense>
    </div>
  );
}

async function Body() {
  return <MachineForm machineId={null} initial={EMPTY_MACHINE_FORM} options={await getMachineFormOptions()} />;
}
