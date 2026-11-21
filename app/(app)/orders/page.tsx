import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/common/page-header";
import { OrdersBoard } from "@/components/orders/board";
import { Skeleton } from "@/components/ui/skeleton";
import { blobEnv } from "@/lib/blob";
import { getDepartments } from "@/lib/data";
import { getBoardTickets } from "@/lib/orders-data";

export const metadata: Metadata = { title: "Orders & Billing" };

export default function OrdersPage() {
  return (
    <div>
      <PageHeader
        title="Orders & Billing"
        description={
          <>
            Every accepted service, from PO to payment.<span className="hidden lg:inline"> Drag a card to the next step, or use its buttons.</span>
          </>
        }
      />
      <Suspense fallback={<BoardSkeleton />}>
        <Board />
      </Suspense>
    </div>
  );
}

async function Board() {
  const [tickets, depts] = await Promise.all([getBoardTickets(), getDepartments()]);
  const customers = [...new Map(tickets.map((t) => [t.customerId, { id: t.customerId, name: t.companyName }])).values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  return <OrdersBoard tickets={tickets} customers={customers} uploadEnv={blobEnv()} departments={depts.map((d) => d.code)} />;
}

function BoardSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-12 rounded-xl" />
      <Skeleton className="h-10 w-2/3 rounded-xl" />
      <div className="grid gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[60vh] rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
