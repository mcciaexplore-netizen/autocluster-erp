import type { Metadata } from "next";
import { Suspense } from "react";
import { FormSkeleton } from "@/components/common/form-skeleton";
import { PageHeader } from "@/components/common/page-header";
import { FormSection } from "@/components/forms/field";
import { SettingsForm } from "@/components/settings/settings-form";
import { TALLY_CONNECTION } from "@/lib/tally";
import { Plug } from "lucide-react";
import { getSettings } from "@/lib/data";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Settings" description="Organisation details, discounts, tax and quotation defaults." />
      <Suspense fallback={<FormSkeleton />}>
        <Form />
      </Suspense>
      <div className="mt-8">
        <TallySection />
      </div>
    </div>
  );
}

async function Form() {
  const s = await getSettings();
  return (
    <SettingsForm
      initial={{
        orgName: s.orgName,
        orgAddress: s.orgAddress,
        orgGstin: s.orgGstin,
        orgPhone: s.orgPhone,
        orgEmail: s.orgEmail,
        memberDiscountPct: Number(s.memberDiscountPct),
        applyDiscountToNonMsme: s.applyDiscountToNonMsme,
        gstPct: Number(s.gstPct),
        homeStateCode: s.homeStateCode,
        quoteValidityDays: s.quoteValidityDays,
        quotePrefix: s.quotePrefix,
        defaultTerms: s.defaultTerms,
      }}
    />
  );
}

function TallySection() {
  return (
    <FormSection title="Tally connection" description="Send tax invoices straight to TallyPrime." icon={<Plug className="size-5" />}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium">
          <span className="size-2 rounded-full bg-muted-foreground" aria-hidden />
          {TALLY_CONNECTION.label}
        </span>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        For now, use <strong>Export to Tally</strong> on a Billing card to download the billing details (Excel), then create the invoice in TallyPrime.
      </p>
    </FormSection>
  );
}
