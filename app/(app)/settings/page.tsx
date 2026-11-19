import type { Metadata } from "next";
import { Suspense } from "react";
import { FormSkeleton } from "@/components/common/form-skeleton";
import { PageHeader } from "@/components/common/page-header";
import { SettingsForm } from "@/components/settings/settings-form";
import { getSettings } from "@/lib/data";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Settings" description="Organisation details, discounts, tax and quotation defaults." />
      <Suspense fallback={<FormSkeleton />}>
        <Form />
      </Suspense>
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
