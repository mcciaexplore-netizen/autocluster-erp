"use client";

import { AlertTriangle, Ban, Loader2, Trash2, Wrench } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useConfirm } from "@/components/common/confirm";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  blockTimeAction,
  deleteBlockAction,
  markBreakdownAction,
  markFixedAction,
} from "@/lib/actions/planning";
import { formatWhen, hhmm, istDate, istMinutes } from "@/lib/planning/hours";
import { BLOCK_TYPES, type BlockTypeName } from "@/lib/validation/planning";

type Pick = { id: string; name: string; code: string; deptCode: string };
type Clash = {
  id: string;
  ticketNo: string;
  company: string;
  startAt: string;
  endAt: string;
};

/** A date-time box value in India time: "2026-11-30T09:00". */
export const localValue = (d: Date) =>
  `${istDate(d)}T${hhmm(Math.floor(istMinutes(d)))}`;
const roundUpHalfHour = (d: Date) =>
  new Date(Math.ceil(d.getTime() / 1_800_000) * 1_800_000);

function ClashList({
  clashes,
  machine,
}: {
  clashes: Clash[];
  machine: string;
}) {
  if (!clashes.length) return null;
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
      <p className="flex items-center gap-2 font-medium">
        <AlertTriangle className="size-4 shrink-0" aria-hidden />
        {clashes.length}{" "}
        {clashes.length === 1 ? "booking clashes" : "bookings clash"} with this
        on {machine}. Move {clashes.length === 1 ? "it" : "them"} to another
        time or machine.
      </p>
      <ul className="mt-2 flex flex-col gap-1 pl-6">
        {clashes.map((c) => (
          <li key={c.id}>
            <Link
              href={`/planning/jobs?booking=${c.id}`}
              className="font-medium underline"
            >
              {c.ticketNo}
            </Link>{" "}
            {c.company}: {formatWhen(new Date(c.startAt))} to{" "}
            {formatWhen(new Date(c.endAt))}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * After a breakdown is marked or extended, the page refreshes (and the button that opened the
 * dialog may change), so the result is shown as a message that stays until it's closed.
 */
export function showClashes(machine: string, clashes: Clash[], what: string) {
  if (!clashes.length)
    return void toast.success(`${machine}: ${what}. No bookings clash.`);
  toast.warning(
    `${machine}: ${what}. ${clashes.length} ${clashes.length === 1 ? "booking clashes" : "bookings clash"}; move ${clashes.length === 1 ? "it" : "them"} from the machine page (“Move to next free slot” or “Pick another machine”).`,
    {
      description: clashes
        .map(
          (c) =>
            `${c.ticketNo} ${c.company}: ${formatWhen(new Date(c.startAt))} to ${formatWhen(new Date(c.endAt))}`,
        )
        .join("\n"),
      duration: Infinity,
      closeButton: true,
    },
  );
}

/** "Block time": the machine is not available (maintenance, calibration, breakdown, internal use, other). */
export function BlockTimeButton({
  machines,
  machineId,
  variant = "outline",
}: {
  machines?: Pick[];
  machineId?: string;
  variant?: "outline" | "default";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [machine, setMachine] = useState(machineId ?? "");
  const [type, setType] = useState<BlockTypeName>("MAINTENANCE");
  const [from, setFrom] = useState(() =>
    localValue(roundUpHalfHour(new Date())),
  );
  const [to, setTo] = useState(() =>
    localValue(new Date(roundUpHalfHour(new Date()).getTime() + 2 * 3_600_000)),
  );
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);
  const [clashes, setClashes] = useState<{
    machine: string;
    list: Clash[];
  } | null>(null);
  const [pending, startT] = useTransition();
  const error = !machine
    ? "Please choose the machine."
    : !from || !to
      ? "Please enter both times."
      : to <= from
        ? "The end should be after the start."
        : undefined;

  return (
    <>
      <Button
        variant={variant}
        onClick={() => (setOpen(true), setClashes(null))}
      >
        <Ban aria-hidden /> Block time
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Block time</DialogTitle>
            <DialogDescription>
              The machine is not available. It shows as grey stripes on the
              timeline, and nothing can be booked over it.
            </DialogDescription>
          </DialogHeader>
          {clashes ? (
            <>
              <ClashList clashes={clashes.list} machine={clashes.machine} />
              <DialogFooter>
                <Button onClick={() => setOpen(false)}>Done</Button>
              </DialogFooter>
            </>
          ) : (
            <form
              noValidate
              className="flex flex-col gap-4"
              onSubmit={(ev) => {
                ev.preventDefault();
                setTouched(true);
                if (error) return;
                startT(async () => {
                  const r = await blockTimeAction({
                    machineId: machine,
                    type,
                    from,
                    to,
                    note,
                  });
                  if (!r.ok) return void toast.error(r.message);
                  toast.success(
                    `${r.data.machine}: ${BLOCK_TYPES[type].toLowerCase()} blocked`,
                  );
                  router.refresh();
                  if (r.data.clashes.length)
                    setClashes({
                      machine: r.data.machine,
                      list: r.data.clashes,
                    });
                  else setOpen(false);
                });
              }}
            >
              {machines && !machineId ? (
                <Field
                  label="Machine"
                  required
                  error={
                    touched && !machine
                      ? "Please choose the machine."
                      : undefined
                  }
                >
                  {(p) => (
                    <Select value={machine} onValueChange={setMachine}>
                      <SelectTrigger
                        id={p.id}
                        className="w-full"
                        aria-invalid={p["aria-invalid"]}
                      >
                        <SelectValue placeholder="Choose the machine" />
                      </SelectTrigger>
                      <SelectContent>
                        {machines.map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.deptCode} · {m.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </Field>
              ) : null}
              <Field label="Why" required>
                {(p) => (
                  <Select
                    value={type}
                    onValueChange={(v) => setType(v as BlockTypeName)}
                  >
                    <SelectTrigger id={p.id} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(BLOCK_TYPES) as BlockTypeName[]).map(
                        (t) => (
                          <SelectItem key={t} value={t}>
                            {BLOCK_TYPES[t]}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                )}
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="From" required>
                  {(p) => (
                    <Input
                      {...p}
                      type="datetime-local"
                      step={1800}
                      value={from}
                      onChange={(e) => setFrom(e.target.value)}
                    />
                  )}
                </Field>
                <Field
                  label="To"
                  required
                  error={touched && error && machine ? error : undefined}
                >
                  {(p) => (
                    <Input
                      {...p}
                      type="datetime-local"
                      step={1800}
                      value={to}
                      min={from}
                      onChange={(e) => setTo(e.target.value)}
                    />
                  )}
                </Field>
              </div>
              <Field label="Note" optional>
                {(p) => (
                  <Textarea
                    {...p}
                    rows={2}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    maxLength={500}
                    placeholder="e.g. Annual calibration by the supplier"
                  />
                )}
              </Field>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <Ban aria-hidden />
                  )}{" "}
                  Block time
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** "Mark breakdown": blocks the machine from now until a chosen time, then lists the bookings that clash. */
export function BreakdownButton({
  machineId,
  machineName,
}: {
  machineId: string;
  machineName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [until, setUntil] = useState(() =>
    localValue(roundUpHalfHour(new Date(Date.now() + 24 * 3_600_000))),
  );
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  return (
    <>
      <Button
        variant="outline"
        className="text-destructive hover:text-destructive"
        onClick={() => setOpen(true)}
      >
        <AlertTriangle aria-hidden /> Mark breakdown
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Mark {machineName} as broken down?</DialogTitle>
            <DialogDescription>
              It is blocked from now until the time below, and nothing can be
              booked on it. Bookings that clash are then listed, so they can be
              moved.
            </DialogDescription>
          </DialogHeader>
          <>
            <Field label="Expected to be working again" required>
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
            <Field label="What happened" optional>
              {(p) => (
                <Textarea
                  {...p}
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={500}
                  placeholder="e.g. Spindle bearing noise, service engineer called"
                />
              )}
            </Field>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await markBreakdownAction(
                      machineId,
                      until,
                      note || null,
                    );
                    if (!r.ok) return void toast.error(r.message);
                    setOpen(false);
                    showClashes(
                      r.data.machine,
                      r.data.clashes,
                      "marked as broken down",
                    );
                    router.refresh();
                  })
                }
              >
                {pending ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <AlertTriangle aria-hidden />
                )}{" "}
                Mark breakdown
              </Button>
            </DialogFooter>
          </>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function FixedButton({
  machineId,
  size,
}: {
  machineId: string;
  size?: "sm";
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size={size}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await markFixedAction(machineId);
          if (!r.ok) return void toast.error(r.message);
          toast.success(`${r.data.machine} is available again`);
          router.refresh();
        })
      }
    >
      {pending ? (
        <Loader2 className="animate-spin" aria-hidden />
      ) : (
        <Wrench aria-hidden />
      )}{" "}
      Working again
    </Button>
  );
}

export function DeleteBlockButton({
  blockId,
  label,
}: {
  blockId: string;
  label: string;
}) {
  const router = useRouter();
  const [dialog, confirm] = useConfirm();
  const [pending, start] = useTransition();
  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Remove ${label}`}
        disabled={pending}
        onClick={async () => {
          if (
            !(await confirm({
              title: `Remove ${label}?`,
              description:
                "The machine can be booked at this time again. If it has already started, it ends now.",
              confirmLabel: "Remove",
              destructive: true,
            }))
          )
            return;
          start(async () => {
            const r = await deleteBlockAction(blockId);
            if (!r.ok) return void toast.error(r.message);
            toast.success(r.data.message);
            router.refresh();
          });
        }}
      >
        <Trash2 aria-hidden />
      </Button>
      {dialog}
    </>
  );
}
