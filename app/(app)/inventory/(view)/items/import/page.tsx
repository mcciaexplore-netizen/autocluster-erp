import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { FormSkeleton } from "@/components/common/form-skeleton";
import { PageHeader } from "@/components/common/page-header";
import { ItemImport } from "@/components/inventory/item-import";
import { Button } from "@/components/ui/button";
import { getInvLists } from "@/lib/inventory-data";

/** Reads who is signed in (and stops with forbidden() when they may not see it), so it blocks on the server: no instant-navigation validation. */
export const instant = false;

export const metadata: Metadata = { title: "Import items" };

export default function Page() {
  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2">
        <Link href="/inventory/items">
          <ArrowLeft aria-hidden /> All items
        </Link>
      </Button>
      <PageHeader title="Import items from Excel" description="Add many items at once, with the stock already on the shelves (opening stock)." />
      <Suspense fallback={<FormSkeleton />}>
        <Body />
      </Suspense>
    </div>
  );
}

async function Body() {
  const lists = await getInvLists();
  return <ItemImport team={lists.team.filter((t) => t.isActive)} />;
}
