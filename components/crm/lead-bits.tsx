"use client";

import { Clock, Plus, Star } from "lucide-react";
import { ACTIVITY_TYPES, activityDueLabel, activityStatus, PRIORITY_LABELS, type ActivityType } from "@/lib/crm/leads";
import { stageColor } from "@/lib/crm/stages";
import { cn } from "@/lib/utils";

/** 0-3 stars. Click a star to set it; click the same star again to clear. */
export function PriorityStars({ value, onChange, size = "sm" }: { value: number; onChange?: (v: number) => void; size?: "sm" | "md" }) {
  const icon = size === "sm" ? "size-4" : "size-5";
  if (!onChange) {
    return (
      <span className="inline-flex" aria-label={`Priority: ${PRIORITY_LABELS[value]}`} title={PRIORITY_LABELS[value]}>
        {[1, 2, 3].map((n) => (
          <Star key={n} className={cn(icon, n <= value ? "fill-amber-400 text-amber-500" : "text-muted-foreground/40")} aria-hidden />
        ))}
      </span>
    );
  }
  return (
    <span role="group" aria-label="Priority" className="inline-flex" onPointerDown={(e) => e.stopPropagation()}>
      {[1, 2, 3].map((n) => (
        <button
          key={n}
          type="button"
          aria-label={`${n} ${n === 1 ? "star" : "stars"} (${PRIORITY_LABELS[n]})`}
          aria-pressed={n <= value}
          title={n === value ? "Click again to clear" : PRIORITY_LABELS[n]}
          onClick={() => onChange(n === value ? 0 : n)}
          className="grid size-7 place-items-center rounded-md hover:bg-secondary"
        >
          <Star className={cn(icon, n <= value ? "fill-amber-400 text-amber-500" : "text-muted-foreground/50")} aria-hidden />
        </button>
      ))}
    </span>
  );
}

const ACT_STYLE = {
  planned: "bg-emerald-50 text-emerald-700 border-emerald-200",
  today: "bg-amber-50 text-amber-700 border-amber-300",
  overdue: "bg-red-50 text-red-700 border-red-200",
  none: "bg-secondary text-muted-foreground border-border",
} as const;

/** Next activity: green clock (planned), amber (today), red (overdue), grey + (none; click to plan one). */
export function ActivityIcon({
  activity,
  today,
  onPlan,
}: {
  activity: { type: ActivityType; dueDate: string; dueTime: string | null } | null;
  today: string;
  onPlan?: () => void;
}) {
  const st = activityStatus(activity?.dueDate, today);
  const label = activity
    ? `${ACTIVITY_TYPES[activity.type]}: ${activityDueLabel(activity.dueDate, today)}${activity.dueTime ? ` at ${activity.dueTime.slice(0, 5)}` : ""}`
    : "No activity planned";
  const body = st === "none" ? <Plus className="size-4" aria-hidden /> : <Clock className="size-4" aria-hidden />;
  const cls = cn("grid size-8 place-items-center rounded-full border", ACT_STYLE[st]);
  if (onPlan)
    return (
      <button type="button" className={cn(cls, "hover:brightness-95")} title={st === "none" ? "No activity planned. Click to plan one." : label} aria-label={st === "none" ? "Plan an activity" : label} onClick={onPlan} onPointerDown={(e) => e.stopPropagation()}>
        {body}
      </button>
    );
  return (
    <span className={cls} title={label} aria-label={label} role="img">
      {body}
    </span>
  );
}

export function StagePill({ name, color, className }: { name: string; color: string; className?: string }) {
  return <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-sm font-medium whitespace-nowrap", stageColor(color).pill, className)}>{name}</span>;
}

export function Initials({ name }: { name: string | null }) {
  if (!name) return null;
  const ini = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground" title={`Assigned to ${name}`} aria-label={`Assigned to ${name}`} role="img">
      {ini}
    </span>
  );
}
