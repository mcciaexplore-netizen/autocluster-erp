"use client";

import { Expand } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { loadLeadDetail } from "@/lib/actions/crm";
import type { LeadDetail, LeadFormOptions } from "@/lib/crm-data";
import { EMPTY_LEAD_FORM, type LeadFormValues } from "@/lib/validation/lead";
import { LeadDetailView } from "./lead-detail";
import { LeadForm } from "./lead-form";
import { useCrmFilters } from "./use-crm-filters";

/** The form's values for an existing enquiry. */
export function formValuesFromDetail(d: LeadDetail): LeadFormValues {
  const l = d.lead;
  return {
    title: l.title,
    sourceId: l.sourceId,
    deptCodes: d.deptCodes,
    serviceIds: d.services.map((s) => s.id),
    expectedValue: l.expectedValuePaise != null ? String(l.expectedValuePaise / 100) : "",
    expectedCloseDate: l.expectedCloseDate ?? "",
    priority: l.priority,
    assignedTo: l.assignedTo ?? "",
    tagIds: d.tags.map((t) => t.id),
    stageId: l.stageId,
    existingCustomer: !!l.customerId,
    customerId: l.customerId ?? "",
    companyName: l.companyName,
    contactName: l.contactName,
    designation: l.designation ?? "",
    phone: l.phone ?? "",
    email: l.email ?? "",
    city: l.city ?? "",
    category: l.category ?? "",
    isMcciaMember: l.isMcciaMember == null ? "" : l.isMcciaMember ? "yes" : "no",
    mcciaMembershipId: l.mcciaMembershipId ?? "",
    notes: l.notes ?? "",
  };
}

/** New-enquiry values: first open stage, plus anything typed in quick add. */
export function newFormValues(options: LeadFormOptions, draft?: Partial<LeadFormValues>): LeadFormValues {
  const first = options.stages.find((s) => s.type === "OPEN");
  return { ...EMPTY_LEAD_FORM, stageId: first?.id ?? "", ...draft };
}

/**
 * Side panel on the board and list:
 * ?new=1 -> new enquiry form, ?lead=<id> -> the enquiry, ?lead=<id>&edit=1 -> edit form.
 */
export function LeadPanel({ options, refreshKey, createDraft }: { options: LeadFormOptions; refreshKey: string; createDraft?: Partial<LeadFormValues> | null }) {
  const router = useRouter();
  const { params, set } = useCrmFilters();
  const leadId = params.get("lead");
  const isNew = params.get("new") === "1";
  const editing = params.get("edit") === "1";
  const open = isNew || !!leadId;

  const [detail, setDetail] = useState<LeadDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!leadId) return;
    let live = true;
    loadLeadDetail(leadId).then((r) => {
      if (!live) return;
      if (r.ok) {
        setDetail(r.data);
        setError(null);
      } else setError(r.message);
    });
    return () => {
      live = false;
    };
  }, [leadId, refreshKey, reload]);

  const d = detail && detail.lead.id === leadId ? detail : null;
  const dirtyRef = useRef(false);
  const onDirty = (v: boolean) => {
    dirtyRef.current = v;
  };
  const leave = (patch: Record<string, string | null>) => {
    if (dirtyRef.current && !window.confirm("You have unsaved changes. If you close the form now, they will be lost. Close it?")) return;
    dirtyRef.current = false;
    set(patch);
  };
  const close = () => leave({ lead: null, new: null, edit: null });
  const changed = () => {
    setReload((n) => n + 1);
    router.refresh();
  };

  const title = isNew ? "New enquiry" : editing ? `Edit ${d?.lead.leadNo ?? "enquiry"}` : (d?.lead.title ?? "Enquiry");

  return (
    <Sheet open={open} onOpenChange={(o) => !o && close()}>
      <SheetContent side="right" className="gap-0 overflow-y-auto p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
        <SheetHeader className="border-b p-5 pr-12">
          <SheetTitle className="text-xl leading-snug">{title}</SheetTitle>
          <SheetDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {isNew ? "Add the enquiry details. Only the fields marked * are needed." : d ? `${d.lead.companyName} · ${d.lead.contactName}` : " "}
            {!isNew && leadId && !editing ? (
              <Link href={`/crm/enquiries/${leadId}`} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                <Expand className="size-3.5" aria-hidden /> Open full page
              </Link>
            ) : null}
          </SheetDescription>
        </SheetHeader>

        <div className="p-5">
          {isNew ? (
            <LeadForm
              key={`new-${JSON.stringify(createDraft ?? {})}`}
              mode="create"
              initial={newFormValues(options, createDraft ?? undefined)}
              options={options}
              fullPageHref="/crm/enquiries/new"
              onDirtyChange={onDirty}
              onCancel={close}
              onSaved={(r) => {
                dirtyRef.current = false;
                router.refresh();
                set({ new: null, lead: r.id, edit: null });
              }}
            />
          ) : error ? (
            <p className="rounded-xl bg-red-50 p-4 text-red-800">{error}</p>
          ) : !d ? (
            <div className="space-y-3" aria-busy="true">
              <Skeleton className="h-28 rounded-xl" />
              <Skeleton className="h-12 rounded-xl" />
              <Skeleton className="h-48 rounded-xl" />
            </div>
          ) : editing ? (
            <LeadForm
              key={`edit-${d.lead.id}`}
              mode="edit"
              leadId={d.lead.id}
              initial={formValuesFromDetail(d)}
              options={options}
              fullPageHref={`/crm/enquiries/${d.lead.id}/edit`}
              onDirtyChange={onDirty}
              onCancel={() => leave({ edit: null })}
              onSaved={() => {
                dirtyRef.current = false;
                changed();
                set({ edit: null });
              }}
            />
          ) : (
            <LeadDetailView detail={d} stages={options.stages} lostReasons={options.lostReasons} onChanged={changed} onEdit={() => set({ edit: "1" })} onDeleted={close} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
