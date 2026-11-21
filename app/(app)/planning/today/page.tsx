import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/common/page-header";
import { TodayBoard } from "@/components/planning/today";
import { Skeleton } from "@/components/ui/skeleton";
import { getToday } from "@/lib/planning-data";

export const metadata: Metadata = { title: "Today" };

export default function TodayPage() {
  return (
    <div>
      <PageHeader title="Today" description="Your jobs for today. Start, pause and finish them here." />
      <Suspense fallback={<Skeleton className="mx-auto h-96 max-w-2xl rounded-2xl" />}>
        <Body />
      </Suspense>
    </div>
  );
}

async function Body() {
  return <TodayBoard data={await getToday()} />;
}
