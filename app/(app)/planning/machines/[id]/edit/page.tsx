import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { FormSkeleton } from "@/components/common/form-skeleton";
import { PageHeader } from "@/components/common/page-header";
import { MachineForm } from "@/components/planning/machine-form";
import { Button } from "@/components/ui/button";
import { getMachine, getMachineFormOptions } from "@/lib/planning-data";
import { UUID_RE } from "@/lib/inventory/uuid";

/** Reads who is signed in (and stops with forbidden() when they may not see it), so it blocks on the server: no instant-navigation validation. */
export const instant = false;

export const metadata: Metadata = { title: "Edit machine" };

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <div className="mx-auto max-w-4xl">
      <Suspense fallback={<FormSkeleton />}>
        <Body params={params} />
      </Suspense>
    </div>
  );
}

async function Body({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const [d, options] = await Promise.all([getMachine(id), getMachineFormOptions()]);
  if (!d) notFound();
  const m = d.machine;
  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2">
        <Link href={`/planning/machines/${m.id}`}>
          <ArrowLeft aria-hidden /> {m.name}
        </Link>
      </Button>
      <PageHeader title={`Edit ${m.name}`} />
      <MachineForm
        machineId={m.id}
        options={options}
        initial={{
          name: m.name,
          code: m.code,
          deptCode: m.deptCode,
          makeModel: m.makeModel ?? "",
          keySpecs: m.keySpecs ?? "",
          testStandards: m.testStandards ?? "",
          nablAccredited: m.nablAccredited,
          serviceIds: d.services.map((s) => s.id),
          parallelJobs: m.parallelJobs,
          runsNonstop: m.runsNonstop,
          location: m.location ?? "",
          status: m.status,
          notes: m.notes ?? "",
        }}
      />
    </>
  );
}
