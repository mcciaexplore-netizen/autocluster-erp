import type { Metadata } from "next";
import { Suspense } from "react";
import { AreaGate } from "@/components/auth/area-gate";
import { PageHeader } from "@/components/common/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { ActivityLog } from "@/components/users/activity-log";
import { activityFiltersFromParams, getActivityOptions, getActivityStats, listActivity } from "@/lib/activity-data";

/** Checks who is signed in and what they may see (forbidden() otherwise), so it blocks on the server: no instant-navigation validation. */
export const instant = false;

export const metadata: Metadata = { title: "Activity log" };

type Sp = Promise<Record<string, string | string[] | undefined>>;

export default function ActivityPage({ searchParams }: { searchParams: Sp }) {
  return (
    <AreaGate perm="users.manage" area="the Activity log">
      <PageHeader title="Activity log" description="Who did what, and when: changes, stock records, payments, permissions and sign-ins." />
      <Suspense fallback={<Skeleton className="h-96 rounded-2xl" />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </AreaGate>
  );
}

async function Body({ searchParams }: { searchParams: Sp }) {
  const [log, options, stats] = await Promise.all([listActivity(activityFiltersFromParams(await searchParams)), getActivityOptions(), getActivityStats()]);
  return <ActivityLog rows={log.rows} more={log.more} limit={log.limit} users={options.users} areas={options.areas} stats={stats} />;
}
