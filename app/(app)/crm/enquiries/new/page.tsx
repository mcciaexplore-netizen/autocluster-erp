import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { FormSkeleton } from "@/components/common/form-skeleton";
import { PageHeader } from "@/components/common/page-header";
import { NewLeadPage } from "@/components/crm/lead-pages";
import { Button } from "@/components/ui/button";
import { getLeadFormOptions } from "@/lib/crm-data";

export const metadata: Metadata = { title: "New enquiry" };

export default function Page() {
  return (
    <div className="mx-auto max-w-4xl">
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2">
        <Link href="/crm">
          <ArrowLeft aria-hidden /> All enquiries
        </Link>
      </Button>
      <PageHeader title="New enquiry" description="Add the enquiry details. Only the fields marked * are needed." />
      <Suspense fallback={<FormSkeleton />}>
        <Form />
      </Suspense>
    </div>
  );
}

async function Form() {
  return <NewLeadPage options={await getLeadFormOptions()} />;
}
