import { Can } from "@/components/auth/permissions-provider";
import type { Metadata } from "next";
import { Plus, Upload } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { ListSkeleton } from "@/components/common/form-skeleton";
import { PageHeader } from "@/components/common/page-header";
import { ItemsList } from "@/components/inventory/items-list";
import { Button } from "@/components/ui/button";
import { QuickActions } from "@/components/inventory/quick-actions";
import { getDailyUse, getInvLists, listInvItems } from "@/lib/inventory-data";
import { runsOutInDays } from "@/lib/inventory/calc";

export const metadata: Metadata = { title: "Inventory items" };

export default function ItemsPage() {
  return (
    <div>
      <PageHeader
        title="Items"
        description="Materials and consumables, with stock, value and when they run out."
        actions={
          <div className="flex flex-wrap gap-2">
            <Can perm="inventory.items">
              <Button asChild variant="outline">
                <Link href="/inventory/items/import">
                  <Upload aria-hidden /> Import items
                </Link>
              </Button>
            </Can>
            <Can perm="inventory.items">
              <Button asChild variant="outline">
                <Link href="/inventory/items/new">
                  <Plus aria-hidden /> Add item
                </Link>
              </Button>
            </Can>
          </div>
        }
      />
      <QuickActions className="mb-6" />
      <Suspense fallback={<ListSkeleton rows={6} />}>
        <List />
      </Suspense>
    </div>
  );
}

async function List() {
  const [items, lists, use] = await Promise.all([listInvItems(), getInvLists(), getDailyUse()]);
  const runsOut = Object.fromEntries(items.map((i) => [i.id, runsOutInDays(i.qty, use.perItem.get(i.id) ?? 0)]));
  return <ItemsList items={items} categories={lists.categories.filter((c) => c.isActive)} departments={lists.departments} runsOut={runsOut} />;
}
