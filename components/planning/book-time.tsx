"use client";

import { AlertTriangle, CalendarPlus, Loader2, Search, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { useConfirm } from "@/components/common/confirm";
import { Field } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { bookSlotAction, bookTimeAction, findSlotsAction, moveBookingAction } from "@/lib/actions/jobs";
import type { BookingOptions } from "@/lib/planning-data";
import { addWorkingHours, dayPlus, formatHours, formatWhen, istAt, istDate, nextWorkingMoment, patternFromSettings, snapTo30 } from "@/lib/planning/hours";
import { daysBetween, todayInIndia } from "@/lib/tickets";
import { localValue } from "./block-time";

const NONE = "none";

export interface BookJob {
  id: string;
  ticketNo: string;
  company: string;
  service: string;
  serviceId: number | null;
  isCustomItem: boolean;
  waitingForPo: boolean;
  promisedDate: string | null;
  operatorId: string | null;
  /** Hours still unplanned (the default). */
  unplannedHours: number;
}

export interface MoveBooking {
  id: string;
  machineId: string;
  start: string;
  hours: number;
  started: boolean;
}

const fromLocal = (v: string) => istAt(v.slice(0, 10), Number(v.slice(11, 13)) * 60 + Number(v.slice(14, 16)));

/**
 * "Book time" for a job, or (with `move`) moving one of its bookings. The end is worked out live
 * with the working hours; "Find next free slot" offers the 3 earliest options, one tap books.
 */
export function BookTimeDialog({
  open,
  onOpenChange,
  job,
  options,
  move,
  preset,
  pickAnother,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  job: BookJob;
  options: BookingOptions;
  move?: MoveBooking;
  /** From the timeline: machine and start already chosen. */
  preset?: { machineId?: string; start?: string };
  /** "Pick another machine" (from a clash): every machine except the current one. */
  pickAnother?: boolean;
  /** Called after a booking was saved (e.g. so the job panel reloads). */
  onDone?: () => void;
}) {
  const router = useRouter();
  const [dialog, confirm] = useConfirm();
  const pattern = useMemo(() => patternFromSettings(options.hours, options.hours.holidays), [options.hours]);
  const suitable = options.machines.filter((m) => job.serviceId != null && m.serviceIds.includes(job.serviceId));
  const [showAll, setShowAll] = useState(job.isCustomItem || !suitable.length || !!pickAnother);
  const list = (showAll ? options.machines : suitable).filter((m) => !(pickAnother && move && m.id === move.machineId));
  const [machineId, setMachineId] = useState(() => (pickAnother ? "" : (preset?.machineId ?? move?.machineId ?? (suitable.length === 1 ? suitable[0].id : ""))));
  const [start, setStart] = useState(() => preset?.start ?? (move ? localValue(new Date(move.start)) : localValue(new Date(Math.ceil(Date.now() / 1_800_000) * 1_800_000))));
  const [hours, setHours] = useState(String(move?.hours ?? (job.unplannedHours > 0 ? job.unplannedHours : 1)));
  const [operator, setOperator] = useState(job.operatorId ?? "");
  const [note, setNote] = useState("");
  const [slots, setSlots] = useState<{ machineId: string; machine: string; start: string; end: string }[] | null>(null);
  const [pending, startT] = useTransition();

  const machine = options.machines.find((m) => m.id === machineId);
  const h = Number(hours);
  const startOk = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(start);
  const actualStart = machine && startOk ? nextWorkingMoment(snapTo30(fromLocal(start)), pattern, machine.runsNonstop) : null;
  const end = actualStart && h > 0 ? addWorkingHours(actualStart, h, pattern, machine!.runsNonstop) : null;
  const late = end && job.promisedDate ? daysBetween(job.promisedDate, istDate(end)) : 0;
  const holdUntil = dayPlus(todayInIndia(), options.holdDays).split("-").reverse().join("/");

  const done = (msg: string, warning?: string | null) => {
    toast.success(msg, warning ? { description: warning } : undefined);
    setSlots(null);
    onOpenChange(false);
    router.refresh();
    onDone?.();
  };

  const submit = (allowPast = false): void =>
    startT(async (): Promise<void> => {
      if (!machine) return void toast.error("Please choose the machine.");
      if (!(h > 0)) return void toast.error("Enter the hours, e.g. 4.");
      const r = move
        ? await moveBookingAction(move.id, { machineId, ...(move.started ? {} : { start }), hours: h, allowPast })
        : await bookTimeAction({ jobId: job.id, machineId, start, hours: h, operatorId: operator || null, note: note || null, allowPast });
      if (!r.ok) {
        if (r.past && (await confirm({ title: "Book time in the past?", description: r.message, confirmLabel: "Yes, book it" }))) return void submit(true);
        return void toast.error(r.message);
      }
      done(`${job.ticketNo} ${move ? "moved to" : "booked on"} ${r.data.machine}: ${formatWhen(new Date(r.data.start))} to ${formatWhen(new Date(r.data.end))}`, r.data.warning);
    });

  const find = () =>
    startT(async () => {
      if (!(h > 0)) return void toast.error("Enter the hours first, e.g. 4.");
      const ids = list.map((m) => m.id);
      if (!ids.length) return void toast.error("There's no machine to look on. Tick “Show all machines”.");
      const r = await findSlotsAction(ids, h, move?.id ?? null);
      if (!r.ok) return void toast.error(r.message);
      if (!r.data.length) return void toast.error("No free time found in the next 4 months on these machines.");
      setSlots(r.data);
    });

  const take = (s: { machineId: string; machine: string; start: string; end: string }) =>
    startT(async () => {
      const r = move
        ? await moveBookingAction(move.id, { machineId: s.machineId, startExact: s.start, hours: h })
        : await bookSlotAction({ jobId: job.id, machineId: s.machineId, start: s.start, hours: h, operatorId: operator || null, note: note || null });
      if (!r.ok) return void toast.error(r.message);
      done(`${job.ticketNo} ${move ? "moved to" : "booked on"} ${r.data.machine}: ${formatWhen(new Date(r.data.start))} to ${formatWhen(new Date(r.data.end))}`, r.data.warning);
    });

  const groups = options.departments.map((d) => ({ d, ms: list.filter((m) => m.deptCode === d.code) })).filter((g) => g.ms.length);
  return (
    <>
      <Dialog open={open} onOpenChange={(o) => (onOpenChange(o), o || setSlots(null))}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{move ? (pickAnother ? "Pick another machine" : "Move booking") : "Book time"}</DialogTitle>
            <DialogDescription>
              {job.ticketNo} · {job.company} · {job.service}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <Field label="Machine" required>
              {(p) => (
                <Select value={machineId} onValueChange={(v) => (setMachineId(v), setSlots(null))} disabled={move?.started}>
                  <SelectTrigger id={p.id} className="w-full">
                    <SelectValue placeholder="Choose the machine" />
                  </SelectTrigger>
                  <SelectContent>
                    {showAll ? (
                      groups.map(({ d, ms }) => (
                        <SelectGroup key={d.code}>
                          <SelectLabel>
                            {d.code} - {d.name}
                          </SelectLabel>
                          {ms.map((m) => (
                            <SelectItem key={m.id} value={m.id}>
                              {m.name}
                              {m.status === "BREAKDOWN" ? " (broken down)" : ""}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ))
                    ) : (
                      list.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.name}
                          {m.status === "BREAKDOWN" ? " (broken down)" : ""}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              )}
            </Field>
            {!job.isCustomItem && suitable.length && !pickAnother ? (
              <label className="-mt-2 flex min-h-11 items-center gap-2 text-sm">
                <Checkbox checked={showAll} onCheckedChange={(v) => (setShowAll(v === true), setSlots(null))} /> Show all machines
              </label>
            ) : job.isCustomItem ? (
              <p className="-mt-2 text-sm text-muted-foreground">Quoted as a custom item, so every machine is offered.</p>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Start" required helper={move?.started ? "It has started, so only its end can change." : "Snaps to the half hour."}>
                {(p) => <Input {...p} type="datetime-local" step={1800} value={start} onChange={(e) => (setStart(e.target.value), setSlots(null))} disabled={move?.started} />}
              </Field>
              <Field label="Hours" required helper={!move && job.unplannedHours > 0 ? `${formatHours(job.unplannedHours)} still to plan` : undefined}>
                {(p) => <Input {...p} inputMode="decimal" value={hours} onChange={(e) => (setHours(e.target.value), setSlots(null))} />}
              </Field>
            </div>
            <p className="rounded-xl bg-secondary px-3 py-2 text-sm" aria-live="polite">
              {end ? (
                <>
                  Ends <strong>{formatWhen(end)}</strong>
                  {actualStart && startOk && actualStart.getTime() !== snapTo30(fromLocal(start)).getTime() ? ` (starts ${formatWhen(actualStart)}, the next working time)` : ""}
                  {machine?.runsNonstop ? " · runs day and night" : " · working hours only"}
                </>
              ) : (
                "Choose the machine, start and hours to see when it ends."
              )}
            </p>
            {late > 0 ? (
              <p className="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                <AlertTriangle className="size-4 shrink-0" aria-hidden /> Finishes {late} {late === 1 ? "day" : "days"} after the promised date
              </p>
            ) : null}
            {job.waitingForPo && !move ? (
              <p className="rounded-xl border border-amber-300 bg-[repeating-linear-gradient(135deg,#fffbeb_0_6px,#fef3c7_6px_12px)] px-3 py-2 text-sm text-amber-950">
                Tentative: waiting for PO. Held until {holdUntil}; it becomes firm when the PO is saved.
              </p>
            ) : null}
            {!move ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Operator" optional>
                  {(p) => (
                    <Select value={operator || NONE} onValueChange={(v) => setOperator(v === NONE ? "" : v)}>
                      <SelectTrigger id={p.id} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>Not chosen</SelectItem>
                        {options.team.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </Field>
                <Field label="Note" optional>
                  {(p) => <Textarea {...p} rows={1} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />}
                </Field>
              </div>
            ) : null}

            {!move?.started ? (
              <div className="rounded-xl border p-3">
                <Button type="button" variant="outline" onClick={find} disabled={pending} className="w-full sm:w-auto">
                  {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Search aria-hidden />} Find next free slot
                </Button>
                <p className="mt-1.5 text-xs text-muted-foreground">On {showAll ? "any machine in the list" : "the machines that run this service"}, after working hours, holidays, blocked time and other jobs.</p>
                {slots ? (
                  <ul className="mt-3 flex flex-col gap-2">
                    {slots.map((s) => (
                      <li key={s.machineId + s.start}>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => take(s)}
                          className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-primary/30 bg-secondary px-3 py-2 text-left text-sm hover:border-primary"
                        >
                          <Sparkles className="size-4 shrink-0 text-primary" aria-hidden />
                          <span>
                            <span className="block font-medium">{s.machine}</span>
                            {formatWhen(new Date(s.start))} to {formatWhen(new Date(s.end))}
                          </span>
                          <span className="ml-auto text-xs font-medium text-primary">{move ? "Move here" : "Book"}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={() => submit()} disabled={pending || !machine || !(h > 0)}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : <CalendarPlus aria-hidden />} {move ? "Save" : "Book time"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {dialog}
    </>
  );
}
