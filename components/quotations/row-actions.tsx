"use client";

import { Copy, Download, Eye, MoreVertical, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { useConfirm } from "@/components/common/confirm";
import { duplicateQuotation, previewStatusChange, setQuotationStatus } from "@/lib/actions/quotations";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { QUOTE_STATUS, QUOTE_STATUSES, type QuoteStatus } from "@/lib/labels";

export function useQuotationActions(id: string) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const duplicate = () =>
    startTransition(async () => {
      const res = await duplicateQuotation(id);
      if (!res.ok) return void toast.error(res.message);
      toast.success(`Copy saved as draft ${res.data.quoteNo}`);
      router.push(`/quotations/${res.data.id}`);
    });
  const [dialog, confirm] = useConfirm();
  const changeStatus = (status: QuoteStatus) =>
    startTransition(async () => {
      const plan = await previewStatusChange(id, status);
      if (!plan.ok) return void toast.error(plan.message);
      const p = plan.data;
      if (p.kind === "blocked") {
        await confirm({ title: "The status can't be changed yet", description: p.message, infoOnly: true });
        return;
      }
      if (p.kind === "open") {
        const total = p.open + p.reopen;
        const ok = await confirm({
          title: "Mark as Accepted?",
          description:
            p.open && !p.reopen
              ? `This will open ${total} ${total === 1 ? "ticket" : "tickets"}, one for each service. Continue?`
              : `This will reopen ${p.reopen} ${p.reopen === 1 ? "ticket" : "tickets"}${p.open ? ` and open ${p.open} new` : ""} on the Orders & Billing board. Continue?`,
          confirmLabel: "Yes, mark Accepted",
        });
        if (!ok) return;
      }
      if (p.kind === "cancel") {
        const ok = await confirm({
          title: `Change to ${QUOTE_STATUS[status].label}?`,
          description: `This quotation's ${p.cancel} ${p.cancel === 1 ? "ticket is" : "tickets are"} still waiting for a PO. ${p.cancel === 1 ? "It" : "They"} will be cancelled. If you mark it Accepted again later, the same ${p.cancel === 1 ? "ticket is" : "tickets are"} reopened.`,
          confirmLabel: "Yes, change status",
          destructive: true,
        });
        if (!ok) return;
      }
      const res = await setQuotationStatus(id, status);
      if (!res.ok) return void toast.error(res.message);
      const r = res.data;
      const extra = r.opened ? `, ${r.opened} ${r.opened === 1 ? "ticket" : "tickets"} opened` : r.reopened ? `, ${r.reopened} reopened` : r.cancelled ? `, ${r.cancelled} cancelled` : "";
      toast.success(`Status changed to ${QUOTE_STATUS[status].label}${extra}`, r.opened || r.reopened ? { action: { label: "Open board", onClick: () => router.push("/orders") } } : undefined);
      router.refresh();
    });
  return { pending, duplicate, changeStatus, dialog };
}

export function QuotationRowActions({ id, quoteNo, status }: { id: string; quoteNo: string; status: QuoteStatus }) {
  const { pending, duplicate, changeStatus, dialog } = useQuotationActions(id);
  return (
    <div className="flex items-center justify-end gap-1">
      {dialog}
      <Button asChild variant="ghost" size="icon-sm" aria-label={`View ${quoteNo}`}>
        <Link href={`/quotations/${id}`}>
          <Eye />
        </Link>
      </Button>
      <Button asChild variant="ghost" size="icon-sm" aria-label={`Download PDF of ${quoteNo}`}>
        <a href={`/quotations/${id}/pdf?download=1`} download>
          <Download />
        </a>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`More for ${quoteNo}`} disabled={pending}>
            {pending ? <RefreshCw className="animate-spin" /> : <MoreVertical />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onSelect={duplicate} className="h-11 text-base">
            <Copy /> Duplicate
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Change status</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={status} onValueChange={(v) => v !== status && changeStatus(v as QuoteStatus)}>
            {QUOTE_STATUSES.map((s) => (
              <DropdownMenuRadioItem key={s} value={s} className="h-11 text-base">
                {QUOTE_STATUS[s].label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
