import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { FormSkeleton } from "@/components/common/form-skeleton";
import { LeadPage } from "@/components/crm/lead-pages";
import { Button } from "@/components/ui/button";
import { getLeadDetail, getLeadFormOptions } from "@/lib/crm-data";

/** Reads who is signed in (and stops with forbidden() when they may not see it), so it blocks on the server: no instant-navigation validation. */
export const instant = false;

export const metadata: Metadata = { title: "Enquiry" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function Page({ params }: PageProps<"/crm/enquiries/[id]">) {
  return (
    <div className="mx-auto max-w-3xl">
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2">
        <Link href="/crm">
          <ArrowLeft aria-hidden /> All enquiries
        </Link>
      </Button>
      <Suspense fallback={<FormSkeleton />}>
        <Detail params={params} />
      </Suspense>
    </div>
  );
}

async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const [detail, options] = await Promise.all([getLeadDetail(id), getLeadFormOptions()]);
  if (!detail) notFound();
  return (
    <>
      <header className="mb-5">
        <h1 className="font-title text-3xl text-primary md:text-4xl">{detail.lead.title}</h1>
        <p className="mt-1 text-muted-foreground">
          {detail.lead.companyName} · {detail.lead.contactName}
        </p>
      </header>
      <LeadPage detail={detail} options={options} />
    </>
  );
}
