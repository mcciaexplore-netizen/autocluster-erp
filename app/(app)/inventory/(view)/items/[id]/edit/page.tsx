import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { FormSkeleton } from "@/components/common/form-skeleton";
import { PageHeader } from "@/components/common/page-header";
import { ItemForm } from "@/components/inventory/item-form";
import { getInvItem, getItemFormOptions } from "@/lib/inventory-data";
import { UUID_RE } from "@/lib/inventory/uuid";

export const metadata: Metadata = { title: "Edit item" };

export default function EditItemPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <div className="mx-auto max-w-4xl">
      <Suspense fallback={<FormSkeleton />}>
        <Form params={params} />
      </Suspense>
    </div>
  );
}

async function Form({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const [d, options] = await Promise.all([getInvItem(id), getItemFormOptions()]);
  if (!d) notFound();
  const i = d.item;
  return (
    <>
      <PageHeader title={`Edit ${i.name}`} description={i.code} />
      <ItemForm
        itemId={i.id}
        currentQty={i.qtyOnHand}
        options={options}
        initial={{
          name: i.name,
          code: i.code,
          categoryId: i.categoryId,
          deptCodes: d.depts,
          unitId: i.unitId,
          packName: i.packName ?? "",
          packSize: i.packSize ? String(Number(i.packSize)) : "",
          reorderLevel: String(Number(i.reorderLevel)),
          reorderQty: String(Number(i.reorderQty)),
          leadTimeDays: i.leadTimeDays != null ? String(i.leadTimeDays) : "",
          preferredSupplierId: i.preferredSupplierId ?? "",
          storagePlace: i.storagePlace ?? "",
          trackBatches: i.trackBatches,
          hsnCode: i.hsnCode ?? "",
          notes: i.notes ?? "",
          isActive: i.isActive,
        }}
      />
    </>
  );
}
