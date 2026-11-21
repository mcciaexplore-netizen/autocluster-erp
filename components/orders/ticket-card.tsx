"use client";

import { JobChip } from "@/components/planning/job-chip";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowLeftRight,
  BellRing,
  Eye,
  FileUp,
  IndianRupee,
  MoreHorizontal,
  NotebookPen,
  Receipt,
  Undo2,
  XCircle,
} from "lucide-react";
import { DeptChip } from "@/components/common/badges";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { BoardTicket } from "@/lib/orders-data";
import { formatINR } from "@/lib/pricing";
import { daysInStep, daysInStepLabel, followUpDue, invoiceChips, STAGE_INFO, STAGES, todayInIndia, type BoardStage } from "@/lib/tickets";
import { cn } from "@/lib/utils";
import { ToneChip } from "./stage-chip";
import type { OpenAction } from "./types";

export function TicketCard({
  ticket: t,
  onAction,
  onMoveTo,
  draggable = true,
  overlay = false,
}: {
  ticket: BoardTicket;
  onAction: OpenAction;
  onMoveTo: (t: BoardTicket, to: BoardStage) => void;
  draggable?: boolean;
  overlay?: boolean;
}) {
  const canDrag = draggable && t.stage !== "PAID" && t.stage !== "CANCELLED";
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: t.id, data: { ticket: t }, disabled: !canDrag });
  const today = todayInIndia();
  const days = daysInStep(t.stageChangedAt);
  const chips = t.invoice && (t.stage === "PAYMENT" || t.stage === "PAID") ? invoiceChips({ ...t.invoice }, today) : [];
  const needsFollowUp = t.stage === "PAYMENT" && t.invoice && followUpDue(t.invoice, today);
  const idx = STAGES.indexOf(t.stage as BoardStage);
  const moveTargets = t.stage === "PAID" || t.stage === "CANCELLED" ? [] : STAGES.filter((_, i) => i === idx - 1 || i === idx + 1);

  return (
    <article
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={cn(
        "rounded-xl border bg-card p-3.5 shadow-[0_1px_2px_rgba(11,31,58,0.06)] transition-shadow",
        canDrag && "cursor-grab active:cursor-grabbing",
        isDragging && !overlay && "opacity-40",
        overlay && "rotate-1 shadow-xl ring-2 ring-primary/30",
      )}
      aria-label={`${t.ticketNo}, ${t.companyName}, ${t.description}`}
      {...(canDrag ? listeners : {})}
      {...(canDrag ? attributes : {})}
      tabIndex={-1}
    >
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={() => onAction("view", t)}
          className="rounded text-left text-sm font-semibold text-primary tabular-nums hover:underline"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {t.ticketNo}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="-mt-1 -mr-1.5 size-9" aria-label={`More for ${t.ticketNo}`} onPointerDown={(e) => e.stopPropagation()}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem className="h-10" onSelect={() => onAction("view", t)}>
              <Eye /> View
            </DropdownMenuItem>
            {moveTargets.length ? (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="h-10">
                  <ArrowLeftRight /> Move to…
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {moveTargets.map((s) => (
                    <DropdownMenuItem key={s} className="h-10" onSelect={() => onMoveTo(t, s)}>
                      {STAGE_INFO[s].title}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ) : null}
            {idx > 0 && t.stage !== "PAID" ? (
              <DropdownMenuItem className="h-10" onSelect={() => onAction("moveBack", t)}>
                <Undo2 /> Move back
              </DropdownMenuItem>
            ) : null}
            {t.stage === "WAITING_PO" || t.stage === "BILLING" ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="h-10 text-destructive focus:text-destructive" onSelect={() => onAction("cancel", t)}>
                  <XCircle /> Cancel ticket
                </DropdownMenuItem>
              </>
            ) : null}
            {t.stage === "CANCELLED" && t.cancelReason ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Cancelled: {t.cancelReason}</DropdownMenuLabel>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <p className="mt-0.5 line-clamp-2 font-medium leading-snug">{t.companyName}</p>
      <p className="text-sm text-muted-foreground">{t.description}</p>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        {t.deptCode ? <DeptChip code={t.deptCode} /> : <span />}
        <span className="text-base font-semibold text-primary tabular-nums">{formatINR(t.totalPaise)}</span>
      </div>

      {t.po && t.stage !== "WAITING_PO" ? (
        <p className="mt-1.5 text-sm text-muted-foreground">
          PO <span className="font-medium text-foreground">{t.po.number}</span>
        </p>
      ) : null}
      {t.invoice && (t.stage === "PAYMENT" || t.stage === "PAID") ? (
        <p className="mt-0.5 text-sm text-muted-foreground">
          Invoice <span className="font-medium text-foreground">{t.invoice.number}</span>
          {t.invoice.ticketCount > 1 ? `, ${t.invoice.ticketCount} services` : ""}
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap gap-1.5">
        {t.job ? <JobChip job={t.job} /> : null}
        {chips.map((c) => (
          <ToneChip key={c.label} tone={c.tone} className="text-xs">
            {c.label}
          </ToneChip>
        ))}
        {needsFollowUp ? (
          <ToneChip tone="amber" className="text-xs">
            Follow-up due
          </ToneChip>
        ) : null}
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">{t.stage === "CANCELLED" ? `Cancelled: ${t.cancelReason ?? ""}` : daysInStepLabel(days)}</p>

      {/* One main button for the column */}
      <div className="mt-3 flex flex-wrap gap-2" onPointerDown={(e) => e.stopPropagation()}>
        {t.stage === "WAITING_PO" ? (
          <Button size="sm" className="w-full" onClick={() => onAction("addPo", t)}>
            <FileUp aria-hidden /> Add PO
          </Button>
        ) : null}
        {t.stage === "BILLING" ? (
          <>
            <Button size="sm" className="w-full" onClick={() => onAction("invoice", t)}>
              <Receipt aria-hidden /> Upload tax invoice
            </Button>
            <Button size="sm" variant="outline" className="w-full" onClick={() => onAction("exportBilling", t)}>
              Export to Tally
              <span className="rounded-full bg-highlight/20 px-1.5 py-0.5 text-[10px] font-semibold text-highlight-foreground">Coming soon</span>
            </Button>
          </>
        ) : null}
        {t.stage === "PAYMENT" ? (
          <>
            <Button size="sm" className="w-full" onClick={() => onAction("payment", t)}>
              <IndianRupee aria-hidden /> Record payment
            </Button>
            <Button size="sm" variant="outline" className="flex-1" onClick={() => onAction("reminder", t)}>
              <BellRing aria-hidden /> Reminder
            </Button>
            <Button size="sm" variant="outline" className="flex-1" onClick={() => onAction("note", t)}>
              <NotebookPen aria-hidden /> Note
            </Button>
          </>
        ) : null}
        {t.stage === "PAID" || t.stage === "CANCELLED" ? (
          <Button size="sm" variant="outline" className="w-full" onClick={() => onAction("view", t)}>
            <Eye aria-hidden /> View
          </Button>
        ) : null}
      </div>
    </article>
  );
}
