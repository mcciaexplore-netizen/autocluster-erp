import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/common/page-header";
import { TodayBoard } from "@/components/planning/today";
import { Skeleton } from "@/components/ui/skeleton";
import { getToday } from "@/lib/planning-data";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";

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
  // A PIN session on a shared device uses the shop-floor screen (it signs out after each action).
  if ((await getCurrentUser())?.floor) redirect("/floor");
  return <TodayBoard data={await getToday()} />;
}
