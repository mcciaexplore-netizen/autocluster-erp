"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { useCan } from "@/components/auth/permissions-provider";
import { moveBookingAction } from "@/lib/actions/jobs";
import { hhmm } from "@/lib/planning/hours";
import { WeekGrid, type WeekGridProps } from "./week-grid";

/**
 * A machine's week, full size: 30-minute rows, ticket no., customer and times on each block, and
 * dragging a booking moves it (with the usual booking rules; the server checks again).
 */
export function MachineWeek(props: Omit<WeekGridProps, "size" | "onMove" | "onEmpty"> & { deptCode: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const canMove = useCan()("planning.book", { dept: props.deptCode });
  return (
    <div aria-busy={pending} className="overflow-x-auto">
      <div className="min-w-[640px]">
        <WeekGrid
          {...props}
          size="full"
          onMove={
            canMove
              ? (b, date, minute) =>
                  start(async () => {
                    const r = await moveBookingAction(b.id, { start: `${date}T${hhmm(minute)}` });
                    if (!r.ok) return void toast.error(r.message);
                    toast.success(`${b.ticketNo} moved`, r.data.warning ? { description: r.data.warning } : undefined);
                    router.refresh();
                  })
              : undefined
          }
        />
      </div>
      {canMove ? <p className="mt-2 text-xs text-muted-foreground">Drag a booking to move it. Started and finished work stays where it is.</p> : null}
    </div>
  );
}
