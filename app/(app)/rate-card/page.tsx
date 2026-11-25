import type { Metadata } from "next";
import { Suspense } from "react";
import { ListSkeleton } from "@/components/common/form-skeleton";
import { PageHeader } from "@/components/common/page-header";
import { RateCardEditor } from "@/components/rate-card/rate-card-editor";
import { getDepartments, getServices } from "@/lib/data";
import { getServiceMaterials, listInvItems } from "@/lib/inventory-data";

/** Reads who is signed in (and stops with forbidden() when they may not see it), so it blocks on the server: no instant-navigation validation. */
export const instant = false;

export const metadata: Metadata = { title: "Rate Card" };

export default function RateCardPage() {
  return (
    <>
      <PageHeader title="Rate Card" description="Standard charges for every service, in rupees, before GST." />
      <Suspense fallback={<ListSkeleton rows={8} />}>
        <RateCard />
      </Suspense>
    </>
  );
}

async function RateCard() {
  const [departments, services, materials, items] = await Promise.all([getDepartments(), getServices(), getServiceMaterials(), listInvItems()]);
  return (
    <RateCardEditor
      departments={departments}
      services={services}
      materials={Object.fromEntries(Object.entries(materials).map(([k, v]) => [k, v.map((m) => ({ itemId: m.itemId, qtyPerUnit: m.qtyPerUnit }))]))}
      items={items.filter((i) => i.isActive).map((i) => ({ id: i.id, name: i.name, code: i.code, qty: i.qty, unit: i.unit }))}
    />
  );
}
