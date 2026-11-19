"use client";

import { Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { quickAddLeadAction } from "@/lib/actions/crm";

/** Odoo-style quick add: a small form at the top of a column. */
export function QuickAdd({
  stageId,
  onDone,
  onCancel,
  onFullForm,
}: {
  stageId: string;
  onDone: (lead: { id: string; leadNo: string }) => void;
  onCancel: () => void;
  onFullForm?: (draft: { title: string; companyName: string; contactName: string; phone: string; expectedValue: string }) => void;
}) {
  const [v, setV] = useState({ title: "", companyName: "", contactName: "", phone: "", expectedValue: "" });
  const [pending, start] = useTransition();
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!v.title.trim()) return void toast.error("Please enter the enquiry title.");
    if (!v.companyName.trim()) return void toast.error("Please enter the company name.");
    if (!v.contactName.trim()) return void toast.error("Please enter the contact person's name.");
    start(async () => {
      const r = await quickAddLeadAction({ stageId, ...v });
      if (!r.ok) return void toast.error(r.message);
      toast.success(`Enquiry ${r.data.leadNo} added`);
      onDone(r.data);
    });
  };
  return (
    <form onSubmit={submit} onKeyDown={(e) => e.key === "Escape" && onCancel()} className="flex flex-col gap-2 rounded-xl border-2 border-primary/30 bg-card p-3 shadow-sm" aria-label="Quick add an enquiry">
      <Input aria-label="Enquiry title" placeholder="Enquiry title, e.g. 3D printing of 20 parts" value={v.title} onChange={set("title")} autoFocus maxLength={200} />
      <Input aria-label="Company" placeholder="Company" value={v.companyName} onChange={set("companyName")} maxLength={200} />
      <Input aria-label="Contact name" placeholder="Contact name" value={v.contactName} onChange={set("contactName")} maxLength={200} />
      <div className="flex min-w-0 items-center rounded-xl border bg-card focus-within:ring-2 focus-within:ring-ring">
        <span className="pl-3 text-sm text-muted-foreground">+91</span>
        <Input aria-label="Mobile" placeholder="Mobile" type="tel" inputMode="numeric" value={v.phone} onChange={set("phone")} className="border-0 shadow-none focus-visible:ring-0" maxLength={15} />
      </div>
      <div className="flex min-w-0 items-center rounded-xl border bg-card focus-within:ring-2 focus-within:ring-ring">
        <span className="pl-3 text-sm text-muted-foreground">₹</span>
        <Input aria-label="Expected value (₹)" placeholder="Expected value (optional)" inputMode="decimal" value={v.expectedValue} onChange={set("expectedValue")} className="border-0 shadow-none focus-visible:ring-0" maxLength={20} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null} Add
        </Button>
        {onFullForm ? (
          <Button type="button" size="sm" variant="outline" onClick={() => onFullForm(v)}>
            Edit full details
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
