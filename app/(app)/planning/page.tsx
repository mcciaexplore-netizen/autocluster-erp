import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/common/page-header";
import { NeedsAttentionPanel } from "@/components/planning/needs-attention";
import { Timeline } from "@/components/planning/timeline";
import { Skeleton } from "@/components/ui/skeleton";
import { getNeedsAttention, getTimeline, timelineFiltersFromParams } from "@/lib/planning-data";

/** Reads who is signed in (and stops with forbidden() when they may not see it), so it blocks on the server: no instant-navigation validation. */
export const instant = false;

export const metadata: Metadata = { title: "Machine timeline" };

type Sp = Promise<Record<string, string | string[] | undefined>>;

export default function TimelinePage({ searchParams }: { searchParams: Sp }) {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Machine timeline" description="Every machine's bookings over time. Drag a job onto a machine to book it; drag a booking to move it, or its right edge to change its hours." />
      <Suspense fallback={<Skeleton className="h-24 rounded-2xl" />}>
        <Attention />
      </Suspense>
      <Suspense fallback={<Skeleton className="h-[32rem] rounded-2xl" />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Attention() {
  return <NeedsAttentionPanel n={await getNeedsAttention()} />;
}

async function Body({ searchParams }: { searchParams: Sp }) {
  const f = await timelineFiltersFromParams(await searchParams);
  const data = await getTimeline(f);
  return <Timeline data={data} view={f.view} date={f.date} />;
}
