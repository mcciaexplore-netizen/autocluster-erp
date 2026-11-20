import type { Metadata } from "next";
import { Suspense } from "react";
import { FormSkeleton } from "@/components/common/form-skeleton";
import { PageHeader } from "@/components/common/page-header";
import { FormSection } from "@/components/forms/field";
import { SettingsForm } from "@/components/settings/settings-form";
import { TALLY_CONNECTION } from "@/lib/tally";
import { Plug } from "lucide-react";
import { getSettings } from "@/lib/data";
import { getCrmLists, getCrmStages } from "@/lib/crm-data";
import { CrmListsSection, InventoryListsSection } from "@/components/crm/crm-lists-section";
import { getInvLists } from "@/lib/inventory-data";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Settings" description="Organisation details, discounts, tax, quotations, billing, CRM and inventory." />
      <Suspense fallback={<FormSkeleton />}>
        <Form />
      </Suspense>
      <div className="mt-8 flex flex-col gap-6">
        <Suspense fallback={<FormSkeleton />}>
          <CrmLists />
        </Suspense>
        <Suspense fallback={<FormSkeleton />}>
          <InvLists />
        </Suspense>
        <TallySection />
      </div>
    </div>
  );
}

async function InvLists() {
  const l = await getInvLists();
  return <InventoryListsSection lists={{ invCategories: l.categories, invUnits: l.units, invPurposes: l.purposes, invReasons: l.reasons }} />;
}

async function CrmLists() {
  return <CrmListsSection lists={await getCrmLists()} />;
}

async function Form() {
  const [s, stages] = await Promise.all([getSettings(), getCrmStages()]);
  return (
    <SettingsForm
      stages={stages.map((st) => ({ id: st.id, name: st.name, type: st.type }))}
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
        ticketPrefix: s.ticketPrefix,
        defaultCreditDays: s.defaultCreditDays,
        whatsappTemplate: s.whatsappTemplate,
        emailSubjectTemplate: s.emailSubjectTemplate,
        emailBodyTemplate: s.emailBodyTemplate,
        defaultTerms: s.defaultTerms,
        leadPrefix: s.leadPrefix,
        leadWhatsappTemplate: s.leadWhatsappTemplate,
        leadEmailSubjectTemplate: s.leadEmailSubjectTemplate,
        leadEmailBodyTemplate: s.leadEmailBodyTemplate,
        quoteCreatedMoveToStageId: s.quoteCreatedMoveToStageId ?? "",
        invInPrefix: s.invInPrefix,
        invOutPrefix: s.invOutPrefix,
        invAdjPrefix: s.invAdjPrefix,
        invItemPrefix: s.invItemPrefix,
        invExpiryWarningDays: s.invExpiryWarningDays,
        invAvgUseDays: s.invAvgUseDays,
        invSafetyDays: s.invSafetyDays,
        invPriceRiseAlertPct: s.invPriceRiseAlertPct,
        invMaterialShareAlertPct: s.invMaterialShareAlertPct,
        invOrderWhatsappTemplate: s.invOrderWhatsappTemplate,
        invOrderEmailSubjectTemplate: s.invOrderEmailSubjectTemplate,
        invOrderEmailBodyTemplate: s.invOrderEmailBodyTemplate,
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
