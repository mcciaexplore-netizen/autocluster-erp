"use client";

import { Loader2, Save, Timer } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Field } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { saveServiceTimeAction } from "@/lib/actions/planning";
import { isPerHour, suggestHours, timeSettingText, type UnitTypeName } from "@/lib/planning/time-needed";

type Svc = { id: number; name: string; unitType: UnitTypeName; unitLabel: string; setupMinutes: number | null; minutesPerUnit: string | null };

/** Rate Card: "Time needed" for a service, used only to suggest a job's hours. */
export function TimeButton({ service }: { service: Svc }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [setup, setSetup] = useState(service.setupMinutes?.toString() ?? "");
  const [per, setPer] = useState(service.minutesPerUnit != null ? String(Number(service.minutesPerUnit)) : "");
  const [pending, start] = useTransition();
  if (isPerHour(service.unitType)) return <span className="text-xs font-normal text-muted-foreground">Time: the billed hours</span>;
  const set = service.setupMinutes != null || service.minutesPerUnit != null;
  const bad = (v: string) => v.trim() !== "" && !(Number(v) >= 0);
  const example = suggestHours({ unitType: service.unitType, billableQty: service.unitType === "PER_CC" ? 200 : 5, setupMinutes: setup ? Number(setup) : null, minutesPerUnit: per ? Number(per) : null });
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-8 items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline">
        <Timer className="size-3.5" aria-hidden />
        {set ? `Time: ${timeSettingText(service)}` : "Time needed"}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form
            noValidate
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (bad(setup) || bad(per)) return void toast.error("Please enter minutes as numbers, e.g. 15.");
              start(async () => {
                const r = await saveServiceTimeAction(service.id, setup.trim() ? Math.round(Number(setup)) : null, per.trim() ? Number(per) : null);
                if (!r.ok) return void toast.error(r.message);
                toast.success(`Time needed saved for ${service.name}`);
                setOpen(false);
                router.refresh();
              });
            }}
          >
            <DialogHeader>
              <DialogTitle>Time needed: {service.name}</DialogTitle>
              <DialogDescription>Only used to suggest how long a job takes. Staff can always change it, e.g. to the print time from the slicer.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Setup time (minutes)" optional error={bad(setup) ? "Enter minutes, e.g. 30." : undefined}>
                {(p) => <Input {...p} inputMode="numeric" value={setup} onChange={(e) => setSetup(e.target.value)} placeholder="e.g. 30" />}
              </Field>
              <Field label={`Minutes ${service.unitLabel}`} optional error={bad(per) ? "Enter minutes, e.g. 15." : undefined}>
                {(p) => <Input {...p} inputMode="decimal" value={per} onChange={(e) => setPer(e.target.value)} placeholder={service.unitType === "PER_CC" ? "e.g. 1.2" : "e.g. 15"} />}
              </Field>
            </div>
            <p className="text-sm text-muted-foreground">
              {example != null ? `Example: ${service.unitType === "PER_CC" ? "200 cc" : "5 samples"} → about ${example} h.` : "Leave both empty if there's no usual time."}
            </p>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />} Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
