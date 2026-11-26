import type { Metadata } from "next";
import { Suspense } from "react";
import { ListSkeleton } from "@/components/common/form-skeleton";
import { PageHeader } from "@/components/common/page-header";
import { JobsList } from "@/components/planning/jobs-list";
import { getBookingOptions, jobFiltersFromParams, listJobs, planningDeptChoice } from "@/lib/planning-data";

/** Reads who is signed in (and stops with forbidden() when they may not see it), so it blocks on the server: no instant-navigation validation. */
export const instant = false;

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
  const sp = await searchParams;
  // Their own departments only; one department opens straight on it.
  const deptChoice = await planningDeptChoice(typeof sp.dept === "string" ? sp.dept : null);
  const f = { ...jobFiltersFromParams(sp), dept: deptChoice.chosen ?? undefined };
  const [jobs, o] = await Promise.all([listJobs(f), getBookingOptions()]);
  return <JobsList jobs={jobs} deptChoice={deptChoice} machines={o.machines.filter((m) => !f.dept || m.deptCode === f.dept).map((m) => ({ id: m.id, name: m.name }))} team={o.team} />;
}
