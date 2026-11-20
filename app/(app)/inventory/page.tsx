import type { Metadata } from "next";
import { Package, Plus, Store } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { PageHeader } from "@/components/common/page-header";
import { ComingNext } from "@/components/inventory/coming-next";
import { QuickActions } from "@/components/inventory/quick-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { listInvItems, listInvSuppliers } from "@/lib/inventory-data";
import { formatINRShort } from "@/lib/pricing";

export const metadata: Metadata = { title: "Inventory" };

export default function InventoryOverview() {
  return (
    <div>
      <PageHeader title="Inventory" description="Materials and consumables: what's in stock, what each job uses, and what to reorder." />
      <QuickActions big className="mb-6" />
      <Suspense fallback={<Skeleton className="h-32 rounded-2xl" />}>
        <Summary />
      </Suspense>
      <div className="mt-6">
        <ComingNext what="The overview cards, “Needs attention” and recent stock in & out come in a later step, with the reorder list, stock counts and insights." />
      </div>
    </div>
  );
}

async function Summary() {
  const [items, suppliers] = await Promise.all([listInvItems(), listInvSuppliers()]);
  const value = items.reduce((a, i) => a + i.valuePaise, 0);
  const cards = [
    { label: "Items", value: items.filter((i) => i.isActive).length.toLocaleString("en-IN"), href: "/inventory/items", icon: Package },
    { label: "Stock value", value: formatINRShort(value), href: "/inventory/items", icon: Package },
    { label: "Suppliers", value: suppliers.filter((s) => s.isActive).length.toLocaleString("en-IN"), href: "/inventory/suppliers", icon: Store },
  ];
  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        {cards.map(({ label, value, href, icon: Icon }) => (
          <Link key={label} href={href} className="rounded-2xl">
            <Card className="h-full transition hover:border-primary/30">
              <CardContent className="flex flex-col gap-3">
                <Icon className="size-6 text-primary/70" aria-hidden />
                <div>
                  <div className="text-2xl font-semibold text-primary tabular-nums md:text-3xl">{value}</div>
                  <div className="text-sm text-muted-foreground">{label}</div>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button asChild>
          <Link href="/inventory/items/new">
            <Plus aria-hidden /> Add item
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/inventory/suppliers/new">
            <Plus aria-hidden /> Add supplier
          </Link>
        </Button>
      </div>
    </>
  );
}
