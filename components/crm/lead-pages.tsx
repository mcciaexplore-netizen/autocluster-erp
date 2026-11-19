"use client";

import { useRouter } from "next/navigation";
import type { LeadDetail, LeadFormOptions } from "@/lib/crm-data";
import { LeadDetailView } from "./lead-detail";
import { LeadForm } from "./lead-form";
import { formValuesFromDetail, newFormValues } from "./lead-panel";

/** /crm/enquiries/new: carries over anything typed in the side panel ("Open full page"). */
export function NewLeadPage({ options }: { options: LeadFormOptions }) {
  const router = useRouter();
  return <LeadForm mode="create" wide restoreDraft initial={newFormValues(options)} options={options} onCancel={() => router.push("/crm")} onSaved={(r) => router.push(`/crm/enquiries/${r.id}`)} />;
}

export function EditLeadPage({ detail, options }: { detail: LeadDetail; options: LeadFormOptions }) {
  const router = useRouter();
  const id = detail.lead.id;
  return (
    <LeadForm
      mode="edit"
      wide
      restoreDraft
      leadId={id}
      initial={formValuesFromDetail(detail)}
      options={options}
      onCancel={() => router.push(`/crm/enquiries/${id}`)}
      onSaved={() => {
        router.push(`/crm/enquiries/${id}`);
        router.refresh();
      }}
    />
  );
}

export function LeadPage({ detail, options }: { detail: LeadDetail; options: LeadFormOptions }) {
  const router = useRouter();
  return (
    <LeadDetailView
      detail={detail}
      stages={options.stages}
      lostReasons={options.lostReasons}
      onChanged={() => router.refresh()}
      onEdit={() => router.push(`/crm/enquiries/${detail.lead.id}/edit`)}
      onDeleted={() => router.push("/crm")}
    />
  );
}
