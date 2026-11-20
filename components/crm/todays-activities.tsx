"use client";

import { Check, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { TodaysActivity } from "@/lib/crm-data";
import { ACTIVITY_TYPES, activityDueLabel, activityStatus, todayInIndia } from "@/lib/crm/leads";
import { timeLabel } from "@/lib/crm/time";
import { cn } from "@/lib/utils";
import { ACTIVITY_ICONS } from "./activity-dialogs";
import { useActivityFlow } from "./use-activity-flow";

/** Home page: planned activities due today (and overdue), each with "Mark done". */
export function TodaysActivities({ items, team }: { items: TodaysActivity[]; team: { id: string; name: string }[] }) {
  const router = useRouter();
  const flow = useActivityFlow({ team, onChanged: () => router.refresh() });
  const today = todayInIndia();
  if (!items.length) {
    return (
      <p className="flex items-center gap-2 rounded-2xl border border-dashed bg-card p-5 text-muted-foreground">
        <CheckCircle2 className="size-5 text-success" aria-hidden /> Nothing due today. Well done.
      </p>
    );
  }
  return (
    <>
      {flow.elements}
      <ul className="divide-y rounded-2xl border bg-card">
        {items.map((a) => {
          const st = activityStatus(a.dueDate, today);
          const Icon = ACTIVITY_ICONS[a.type];
          return (
            <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
              <span className={cn("grid size-10 shrink-0 place-items-center rounded-full border", st === "overdue" ? "border-red-200 bg-red-50 text-red-700" : "border-amber-300 bg-amber-50 text-amber-700")}>
                <Icon className="size-5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">
                  {ACTIVITY_TYPES[a.type]}
                  {a.dueTime ? ` at ${timeLabel(a.dueTime)}` : ""}{" "}
                  <span className={cn("text-sm", st === "overdue" ? "font-semibold text-red-700" : "text-amber-700")}>· {activityDueLabel(a.dueDate, today)}</span>
                </span>
                <Link href={`/crm?lead=${a.leadId}`} className="block truncate text-sm text-primary hover:underline">
                  {a.leadTitle} · {a.companyName}
                </Link>
                {a.note || a.assignedToName ? (
                  <span className="block truncate text-sm text-muted-foreground">{[a.assignedToName, a.note].filter(Boolean).join(" · ")}</span>
                ) : null}
              </span>
              <Button size="sm" variant="outline" onClick={() => flow.openDone({ id: a.id, type: a.type, leadId: a.leadId, title: a.leadTitle, assignedTo: a.assignedTo })}>
                <Check aria-hidden /> Mark done
              </Button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
