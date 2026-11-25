import type { Metadata } from "next";
import { PageHeader } from "@/components/common/page-header";
import { SupplierForm } from "@/components/inventory/supplier-form";
import { EMPTY_SUPPLIER_FORM } from "@/lib/validation/inventory";

/** Reads who is signed in (and stops with forbidden() when they may not see it), so it blocks on the server: no instant-navigation validation. */
export const instant = false;

export const metadata: Metadata = { title: "Add supplier" };

export default function NewSupplierPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Add supplier" />
      <SupplierForm supplierId={null} initial={EMPTY_SUPPLIER_FORM} />
    </div>
  );
}
