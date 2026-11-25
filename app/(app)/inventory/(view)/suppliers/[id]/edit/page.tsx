import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { FormSkeleton } from "@/components/common/form-skeleton";
import { PageHeader } from "@/components/common/page-header";
import { SupplierForm } from "@/components/inventory/supplier-form";
import { getInvSupplier } from "@/lib/inventory-data";
import { UUID_RE } from "@/lib/inventory/uuid";

/** Reads who is signed in (and stops with forbidden() when they may not see it), so it blocks on the server: no instant-navigation validation. */
export const instant = false;

export const metadata: Metadata = { title: "Edit supplier" };

export default function EditSupplierPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <div className="mx-auto max-w-3xl">
      <Suspense fallback={<FormSkeleton />}>
        <Form params={params} />
      </Suspense>
    </div>
  );
}

async function Form({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const d = await getInvSupplier(id);
  if (!d) notFound();
  const s = d.supplier;
  return (
    <>
      <PageHeader title={`Edit ${s.name}`} />
      <SupplierForm
        supplierId={s.id}
        initial={{ name: s.name, contactName: s.contactName ?? "", phone: s.phone ?? "", email: s.email ?? "", gstin: s.gstin ?? "", address: s.address ?? "", notes: s.notes ?? "", isActive: s.isActive }}
      />
    </>
  );
}
