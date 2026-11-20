import type { Metadata } from "next";
import { Suspense } from "react";
import { FormSkeleton } from "@/components/common/form-skeleton";
import { PageHeader } from "@/components/common/page-header";
import { ReceiveForm } from "@/components/inventory/receive-form";
import { AdjustForm, UseForm } from "@/components/inventory/use-adjust-forms";
import { blobEnv } from "@/lib/blob";
import { getServiceMaterials, getStockFormData, getTicketsForUse } from "@/lib/inventory-data";
import { UUID_RE } from "@/lib/inventory/uuid";

export const metadata: Metadata = { title: "Stock in & out" };

const TITLES = {
  in: ["Stock received", "Stock arriving from a supplier. Stock goes up and the average cost is worked out again."],
  out: ["Use stock", "Stock used for a job, or for internal use. It is valued at the current average cost."],
  adj: ["Adjust stock", "Corrections, damage, spills and expired stock. A reason and a note are needed."],
} as const;

type Sp = Promise<Record<string, string | string[] | undefined>>;

export default function NewMovementPage({ searchParams }: { searchParams: Sp }) {
  return (
    <div className="mx-auto max-w-4xl">
      <Suspense fallback={<FormSkeleton />}>
        <Form searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Form({ searchParams }: { searchParams: Sp }) {
  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k][0] : sp[k]);
  const t = one("type");
  const type = t === "out" || t === "adj" ? t : "in";
  const item = one("item");
  const startItemId = item && UUID_RE.test(item) ? item : undefined;
  const ticket = one("ticket");
  const startTicketId = ticket && UUID_RE.test(ticket) ? ticket : undefined;
  const [data, tickets, materials] = await Promise.all([getStockFormData(), type === "out" ? getTicketsForUse() : Promise.resolve([]), type === "out" ? getServiceMaterials() : Promise.resolve({})]);
  const [title, description] = TITLES[type];
  return (
    <>
      <PageHeader title={title} description={description} />
      {type === "in" ? <ReceiveForm key="in" data={data} uploadEnv={blobEnv()} startItemId={startItemId} /> : null}
      {type === "out" ? <UseForm key={`out-${startTicketId ?? ""}`} data={data} startItemId={startItemId} tickets={tickets} materials={materials} startTicketId={startTicketId} /> : null}
      {type === "adj" ? <AdjustForm key="adj" data={data} startItemId={startItemId} /> : null}
    </>
  );
}
