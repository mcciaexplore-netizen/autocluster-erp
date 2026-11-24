import { Can } from "@/components/auth/permissions-provider";
import type { Metadata } from "next";
import { Plus } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { ListSkeleton } from "@/components/common/form-skeleton";
import { PageHeader } from "@/components/common/page-header";
import { SuppliersList } from "@/components/inventory/suppliers-list";
import { Button } from "@/components/ui/button";
import { listInvSuppliers } from "@/lib/inventory-data";

export const metadata: Metadata = { title: "Suppliers" };

export default function SuppliersPage() {
  return (
    <div>
      <PageHeader
        title="Suppliers"
        description="Who you buy materials from, what they supply and what was bought this financial year."
        actions={
          <Can perm="inventory.suppliers">
            <Button asChild>
              <Link href="/inventory/suppliers/new">
                <Plus aria-hidden /> Add supplier
              </Link>
            </Button>
          </Can>
        }
      />
      <Suspense fallback={<ListSkeleton rows={4} />}>
        <List />
      </Suspense>
    </div>
  );
}

async function List() {
  return <SuppliersList rows={await listInvSuppliers()} />;
}
