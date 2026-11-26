import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/common/page-header";
import { DepartmentBoard } from "@/components/planning/department-board";
import { Skeleton } from "@/components/ui/skeleton";
import { getDepartmentBoard, planningDeptChoice } from "@/lib/planning-data";
import { istDate } from "@/lib/planning/hours";

/** Reads who is signed in (and stops with forbidden() when they may not see it), so it blocks on the server: no instant-navigation validation. */
export const instant = false;

export const metadata: Metadata = { title: "Department board" };

type Sp = Promise<Record<string, string | string[] | undefined>>;

export default function DepartmentBoardPage({ searchParams }: { searchParams: Sp }) {
  return (
    <div>
      <PageHeader title="Department board" description="Each machine's week at a glance: what's booked, running and free, hour by hour." />
      <Suspense fallback={<Skeleton className="h-[36rem] rounded-2xl" />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Body({ searchParams }: { searchParams: Sp }) {
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  // Their own departments only; one department opens straight on it. The board opens on a department, not "All".
  const choice = await planningDeptChoice(one("dept") || null, { allByDefault: false });
  const date = /^\d{4}-\d{2}-\d{2}$/.test(one("date")) ? one("date") : istDate(new Date());
  const data = await getDepartmentBoard({ dept: choice.chosen, date });
  return <DepartmentBoard data={data} choice={choice} full24={one("full") === "1"} />;
}
