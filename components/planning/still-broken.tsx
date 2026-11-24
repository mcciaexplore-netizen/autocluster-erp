"use client";

import { Can } from "@/components/auth/permissions-provider";
import { AlertTriangle, CalendarPlus, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Field } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { extendBreakdownAction } from "@/lib/actions/planning";
import { formatDayTime } from "@/lib/planning/hours";
import { cn } from "@/lib/utils";
import { FixedButton, localValue, showClashes } from "./block-time";

/** "Still broken down? Expected back 22 Nov, 17:00" with Working again / Extend. */
export function StillBrokenDown({
  machineId,
  machineName,
  expectedEnd,
  compact = false,
}: {
  machineId: string;
  machineName: string;
  expectedEnd: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-xl border border-red-300 bg-red-50 text-red-900",
        compact
          ? "p-2.5 text-sm"
          : "p-3 sm:flex-row sm:items-center sm:justify-between",
      )}
    >
      <p className="flex items-start gap-2 font-medium">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          {compact ? "" : `${machineName}: `}Still broken down? Expected back{" "}
          {formatDayTime(new Date(expectedEnd))}
        </span>
      </p>
      <div className="flex flex-wrap gap-2">
        <Can perm="planning.blocks">
          <FixedButton machineId={machineId} size="sm" />
          <ExtendButton machineId={machineId} machineName={machineName} />
        </Can>
      </div>
    </div>
  );
}

function ExtendButton({
  machineId,
  machineName,
}: {
  machineId: string;
  machineName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [until, setUntil] = useState(() =>
    localValue(
      new Date(
        Math.ceil((Date.now() + 24 * 3_600_000) / 1_800_000) * 1_800_000,
      ),
    ),
  );
  const [pending, start] = useTransition();
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="bg-white"
        onClick={() => setOpen(true)}
      >
        <CalendarPlus aria-hidden /> Extend
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Extend the breakdown of {machineName}</DialogTitle>
            <DialogDescription>
              It stays blocked until the new time. Bookings that clash are
              listed, so they can be moved.
            </DialogDescription>
          </DialogHeader>
          <>
            <Field label="Now expected to be working again" required>
              {(p) => (
                <Input
                  {...p}
                  type="datetime-local"
                  step={1800}
                  value={until}
                  onChange={(e) => setUntil(e.target.value)}
                />
              )}
            </Field>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await extendBreakdownAction(machineId, until);
                    if (!r.ok) return void toast.error(r.message);
                    setOpen(false);
                    showClashes(
                      r.data.machine,
                      r.data.clashes,
                      "breakdown extended",
                    );
                    router.refresh();
                  })
                }
              >
                {pending ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <CalendarPlus aria-hidden />
                )}{" "}
                Extend
              </Button>
            </DialogFooter>
          </>
        </DialogContent>
      </Dialog>
    </>
  );
}
