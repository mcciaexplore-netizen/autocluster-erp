import type { Metadata } from "next";
import { AreaGate } from "@/components/auth/area-gate";
import { settingsAccess } from "@/lib/admin-data";
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
import { HolidaysSection } from "@/components/planning/holidays-section";
import { listHolidays } from "@/lib/planning-data";
import { todayInIndia } from "@/lib/tickets";

/** Checks who is signed in and what they may see (forbidden() otherwise), so it blocks on the server: no instant-navigation validation. */
export const instant = false;

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <AreaGate perm="settings.edit" area="the general settings">
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Settings" description="Organisation details, discounts, tax, quotations, billing, CRM, inventory and planning." />
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
        <Suspense fallback={<FormSkeleton />}>
          <Holidays />
        </Suspense>
        <TallySection />
      </div>
    </div>
    </AreaGate>
  );
}

async function Holidays() {
  await settingsAccess();
  const hs = await listHolidays();
  return <HolidaysSection holidays={hs} today={todayInIndia()} />;
}

async function InvLists() {
  await settingsAccess();
  const l = await getInvLists();
  return <InventoryListsSection lists={{ invCategories: l.categories, invUnits: l.units, invPurposes: l.purposes, invReasons: l.reasons }} />;
}

async function CrmLists() {
  await settingsAccess();
  return <CrmListsSection lists={await getCrmLists()} />;
}

async function Form() {
  await settingsAccess();
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
        invDefaultLeadTimeDays: s.invDefaultLeadTimeDays,
        invPriceRiseAlertPct: s.invPriceRiseAlertPct,
        invMaterialShareAlertPct: s.invMaterialShareAlertPct,
        invOrderWhatsappTemplate: s.invOrderWhatsappTemplate,
        invOrderEmailSubjectTemplate: s.invOrderEmailSubjectTemplate,
        invOrderEmailBodyTemplate: s.invOrderEmailBodyTemplate,
        workingDays: s.workingDays,
        shiftStart: s.shiftStart,
        shiftEnd: s.shiftEnd,
        breakStart: s.breakStart ?? "",
        breakEnd: s.breakEnd ?? "",
        tentativeHoldDays: s.tentativeHoldDays,
        overrunWarningPct: s.overrunWarningPct,
        activityKeepMonths: s.activityKeepMonths,
        signInKeepDays: s.signInKeepDays,
        actualVsQuotedAlertPct: s.actualVsQuotedAlertPct,
        readyWhatsappTemplate: s.readyWhatsappTemplate,
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
