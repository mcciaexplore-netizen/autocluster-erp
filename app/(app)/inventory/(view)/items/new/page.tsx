import type { Metadata } from "next";
import { Suspense } from "react";
import { FormSkeleton } from "@/components/common/form-skeleton";
import { PageHeader } from "@/components/common/page-header";
import { ItemForm } from "@/components/inventory/item-form";
import { getItemFormOptions } from "@/lib/inventory-data";
import { EMPTY_ITEM_FORM } from "@/lib/validation/inventory";

/** Reads who is signed in (and stops with forbidden() when they may not see it), so it blocks on the server: no instant-navigation validation. */
export const instant = false;

export const metadata: Metadata = { title: "Add item" };

export default function NewItemPage() {
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Add item" description="Stock starts at 0. Add it with “Stock received”." />
      <Suspense fallback={<FormSkeleton />}>
        <Form />
      </Suspense>
    </div>
  );
}

async function Form() {
  const options = await getItemFormOptions();
  const unit = options.units.find((u) => u.isActive)?.id ?? "";
  return <ItemForm itemId={null} initial={{ ...EMPTY_ITEM_FORM, unitId: unit }} options={options} />;
}
