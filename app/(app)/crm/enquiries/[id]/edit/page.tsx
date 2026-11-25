import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { FormSkeleton } from "@/components/common/form-skeleton";
import { PageHeader } from "@/components/common/page-header";
import { EditLeadPage } from "@/components/crm/lead-pages";
import { Button } from "@/components/ui/button";
import { getLeadDetail, getLeadFormOptions } from "@/lib/crm-data";

/** Reads who is signed in (and stops with forbidden() when they may not see it), so it blocks on the server: no instant-navigation validation. */
export const instant = false;

export const metadata: Metadata = { title: "Edit enquiry" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function Page({ params }: PageProps<"/crm/enquiries/[id]/edit">) {
  return (
    <div className="mx-auto max-w-4xl">
      <Suspense fallback={<FormSkeleton />}>
        <Edit params={params} />
      </Suspense>
    </div>
  );
}

async function Edit({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const [detail, options] = await Promise.all([getLeadDetail(id), getLeadFormOptions()]);
  if (!detail) notFound();
  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2">
        <Link href={`/crm/enquiries/${id}`}>
          <ArrowLeft aria-hidden /> Back to the enquiry
        </Link>
      </Button>
      <PageHeader title={`Edit ${detail.lead.leadNo}`} description={`${detail.lead.title} · ${detail.lead.companyName}`} />
      <EditLeadPage detail={detail} options={options} />
    </>
  );
}
