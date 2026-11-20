import type { Metadata } from "next";
import { Plus } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { ListSkeleton } from "@/components/common/form-skeleton";
import { PageHeader } from "@/components/common/page-header";
import { ItemsList } from "@/components/inventory/items-list";
import { Button } from "@/components/ui/button";
import { getInvLists, listInvItems } from "@/lib/inventory-data";

export const metadata: Metadata = { title: "Inventory items" };

export default function ItemsPage() {
  return (
    <div>
      <PageHeader
        title="Items"
        description="Materials and consumables, with stock, value and when they run out."
        actions={
          <Button asChild>
            <Link href="/inventory/items/new">
              <Plus aria-hidden /> Add item
            </Link>
          </Button>
        }
      />
      <Suspense fallback={<ListSkeleton rows={6} />}>
        <List />
      </Suspense>
    </div>
  );
}

async function List() {
  const [items, lists] = await Promise.all([listInvItems(), getInvLists()]);
  return <ItemsList items={items} categories={lists.categories.filter((c) => c.isActive)} departments={lists.departments} />;
}
