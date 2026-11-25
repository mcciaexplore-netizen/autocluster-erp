import type { Metadata } from "next";
import { PackageCheck } from "lucide-react";
import { Suspense } from "react";
import { EmptyState } from "@/components/common/empty-state";
import { ListSkeleton } from "@/components/common/form-skeleton";
import { PageHeader } from "@/components/common/page-header";
import { ReorderList } from "@/components/inventory/reorder-list";
import { getInvLists, getReorderList } from "@/lib/inventory-data";

/** Reads who is signed in (and stops with forbidden() when they may not see it), so it blocks on the server: no instant-navigation validation. */
export const instant = false;

export const metadata: Metadata = { title: "Reorder list" };

export default function Page() {
  return (
    <div>
      <PageHeader title="Reorder list" description="What to order before it runs out, grouped by supplier. Tick items, check the quantities, then send the list." />
      <Suspense fallback={<ListSkeleton rows={5} />}>
        <List />
      </Suspense>
    </div>
  );
}

async function List() {
  const [data, lists] = await Promise.all([getReorderList(), getInvLists()]);
  const count = data.groups.reduce((a, g) => a + g.items.length, 0);
  if (!count) return <EmptyState icon={PackageCheck} title="Nothing to order right now" description="Items appear here when stock reaches the reorder level, or will run out before new stock can arrive." />;
  return (
    <>
      <p className="mb-4 text-sm text-muted-foreground">
        {count} {count === 1 ? "item" : "items"} to order: stock at or below the reorder level, or it runs out before new stock can arrive (lead time + {data.safetyDays} safety days, use over the last {data.useDays} days).
      </p>
      <ReorderList data={data} team={lists.team.filter((t) => t.isActive)} />
    </>
  );
}
