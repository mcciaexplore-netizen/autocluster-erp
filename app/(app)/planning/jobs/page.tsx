import type { Metadata } from "next";
import { Suspense } from "react";
import { ListSkeleton } from "@/components/common/form-skeleton";
import { PageHeader } from "@/components/common/page-header";
import { JobsList } from "@/components/planning/jobs-list";
import { getBookingOptions, jobFiltersFromParams, listJobs } from "@/lib/planning-data";

export const metadata: Metadata = { title: "Jobs" };

type Sp = Promise<Record<string, string | string[] | undefined>>;

export default function JobsPage({ searchParams }: { searchParams: Sp }) {
  return (
    <div>
      <PageHeader title="Jobs" description="Every accepted service is a job: what's to plan, planned, running and done. Click a job to plan it." />
      <Suspense fallback={<ListSkeleton rows={8} />}>
        <List searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function List({ searchParams }: { searchParams: Sp }) {
  const f = jobFiltersFromParams(await searchParams);
  const [jobs, o] = await Promise.all([listJobs(f), getBookingOptions()]);
  return <JobsList jobs={jobs} departments={o.departments} machines={o.machines.map((m) => ({ id: m.id, name: m.name }))} team={o.team} />;
}
