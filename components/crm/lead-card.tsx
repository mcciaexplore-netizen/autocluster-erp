"use client";

import { useDraggable } from "@dnd-kit/core";
import { useCan } from "@/components/auth/permissions-provider";
import { CSS } from "@dnd-kit/utilities";
import { ArrowLeftRight, Eye, MoreHorizontal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { BoardLead, BoardStage } from "@/lib/crm-data";
import { daysInStageLabel } from "@/lib/crm/leads";
import { stageColor } from "@/lib/crm/stages";
import { formatINRShort } from "@/lib/pricing";
import { daysInStep } from "@/lib/tickets";
import { cn } from "@/lib/utils";
import { ActivityIcon, Initials, PriorityStars } from "./lead-bits";

export interface LeadCardHandlers {
  onMoveTo: (lead: BoardLead, stageId: string) => void;
  onPriority: (lead: BoardLead, value: number) => void;
  onOpen?: (lead: BoardLead) => void;
  onPlan?: (lead: BoardLead) => void;
  onDelete?: (lead: BoardLead) => void;
}

export function LeadCard({
  lead: l,
  stage,
  stages,
  today,
  handlers,
  draggable = true,
  overlay = false,
}: {
  lead: BoardLead;
  stage: BoardStage;
  stages: BoardStage[];
  today: string;
  handlers: LeadCardHandlers;
  draggable?: boolean;
  overlay?: boolean;
}) {
  // Moving cards needs "crm.edit" (the server checks again).
  const canEdit = useCan()("crm.edit");
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: l.id, data: { lead: l }, disabled: !draggable || !canEdit });
  const stop = { onPointerDown: (e: React.PointerEvent) => e.stopPropagation() };

  return (
    <article
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={cn(
        "rounded-xl border border-l-4 bg-card p-3 shadow-[0_1px_2px_rgba(11,31,58,0.06)] transition-shadow",
        stage.type === "LOST" ? "border-l-red-500" : stage.type === "WON" ? "border-l-emerald-500" : "border-l-transparent",
        draggable && "cursor-grab active:cursor-grabbing",
        isDragging && !overlay && "opacity-40",
        overlay && "rotate-1 shadow-xl ring-2 ring-primary/30",
      )}
      aria-label={`${l.title}, ${l.companyName}`}
      {...(draggable ? listeners : {})}
      {...(draggable ? attributes : {})}
      tabIndex={-1}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {handlers.onOpen ? (
            <button type="button" {...stop} onClick={() => handlers.onOpen!(l)} className="rounded text-left font-semibold leading-snug text-foreground hover:text-primary hover:underline">
              {l.title}
            </button>
          ) : (
            <p className="font-semibold leading-snug">{l.title}</p>
          )}
          <p className="truncate text-sm text-muted-foreground">{l.companyName}</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="-mt-1 -mr-1.5 size-9 shrink-0" aria-label={`More for ${l.title}`} {...stop}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {handlers.onOpen ? (
              <DropdownMenuItem className="h-10" onSelect={() => handlers.onOpen!(l)}>
                <Eye /> Open
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="h-10">
                <ArrowLeftRight /> Move to…
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {stages
                  .filter((s) => s.id !== l.stageId)
                  .map((s) => (
                    <DropdownMenuItem key={s.id} className="h-10" onSelect={() => handlers.onMoveTo(l, s.id)}>
                      <span className={cn("size-2.5 rounded-full", stageColor(s.color).dot)} aria-hidden /> {s.name}
                    </DropdownMenuItem>
                  ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {handlers.onDelete ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="h-10 text-destructive focus:text-destructive" onSelect={() => handlers.onDelete!(l)}>
                  <Trash2 /> Delete
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="font-semibold text-primary tabular-nums">{l.expectedValuePaise != null ? formatINRShort(l.expectedValuePaise) : <span className="text-sm font-normal text-muted-foreground">No value yet</span>}</span>
        <PriorityStars value={l.priority} onChange={overlay ? undefined : (v) => handlers.onPriority(l, v)} />
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        <span className="rounded-full border bg-card px-2 py-0.5 text-xs font-medium text-muted-foreground">{l.sourceName}</span>
        {l.depts.map((d) => (
          <span key={d} className="rounded-full border border-border bg-secondary px-2 py-0.5 text-xs font-medium text-primary">
            {d}
          </span>
        ))}
        {l.tags.map((t) => (
          <span key={t.id} className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-800">
            {t.name}
          </span>
        ))}
      </div>

      {stage.type === "LOST" ? (
        <p className="mt-2 text-sm">
          <span className="mr-1.5 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">Lost</span>
          <span className="text-muted-foreground">{l.lostReason ?? "No reason given"}</span>
        </p>
      ) : stage.type === "WON" ? (
        <p className="mt-2">
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800">Won</span>
        </p>
      ) : null}

      <div className="mt-2.5 flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{daysInStageLabel(daysInStep(l.stageChangedAt))}</span>
        <span className="flex items-center gap-1.5">
          <ActivityIcon
            activity={l.nextActivity}
            today={today}
            onPlan={overlay ? undefined : !l.nextActivity ? (handlers.onPlan ? () => handlers.onPlan!(l) : undefined) : handlers.onOpen ? () => handlers.onOpen!(l) : undefined}
          />
          <Initials name={l.assignedToName} />
        </span>
      </div>
    </article>
  );
}
