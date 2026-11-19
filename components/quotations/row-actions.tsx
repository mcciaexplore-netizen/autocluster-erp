"use client";

import { Copy, Download, Eye, MoreVertical, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { duplicateQuotation, setQuotationStatus } from "@/lib/actions/quotations";
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
  const changeStatus = (status: QuoteStatus) =>
    startTransition(async () => {
      const res = await setQuotationStatus(id, status);
      if (!res.ok) return void toast.error(res.message);
      toast.success(`Status changed to ${QUOTE_STATUS[status].label}`);
      router.refresh();
    });
  return { pending, duplicate, changeStatus };
}

export function QuotationRowActions({ id, quoteNo, status }: { id: string; quoteNo: string; status: QuoteStatus }) {
  const { pending, duplicate, changeStatus } = useQuotationActions(id);
  return (
    <div className="flex items-center justify-end gap-1">
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
