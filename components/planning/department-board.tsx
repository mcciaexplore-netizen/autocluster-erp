"use client";

import { CalendarDays, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { useCan } from "@/components/auth/permissions-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { loadBookJobAction } from "@/lib/actions/jobs";
import type { DepartmentBoardData } from "@/lib/planning-data";
import { boardSummary, weekDates } from "@/lib/planning/board";
import type { DeptChoice } from "@/lib/planning/dept-scope";
import { dayPlus, formatHours, hhmm } from "@/lib/planning/hours";
import { cn } from "@/lib/utils";
import { BookTimeDialog, type BookJob } from "./book-time";
import { DeptChips } from "./dept-chips";
import { MachineStatusChip, pctText } from "./machine-bits";
import { WeekGrid } from "./week-grid";

type Machine = DepartmentBoardData["machines"][number];
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const shortDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

export function DepartmentBoard({ data, choice, full24 }: { data: DepartmentBoardData; choice: DeptChoice; full24: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const can = useCan();
  const [pending, start] = useTransition();
  const [slot, setSlot] = useState<{ machine: Machine; date: string; minute: number } | null>(null);
  const [booking, setBooking] = useState<{ job: BookJob; machineId: string; start: string } | null>(null);

  const set = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v == null) next.delete(k);
      else next.set(k, v);
    }
    start(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }));
  };
  const week = data.weekFrom;
  const forMachine = (m: Machine) => ({
    machine: m,
    weekFrom: week,
    today: data.today,
    nowIso: data.nowIso,
    hours: data.hours,
    holidays: data.holidays,
    allHolidays: data.allHolidays,
    bookings: data.bookings.filter((b) => b.machineId === m.id),
    blocks: data.blocks.filter((b) => b.machineId === m.id),
    full24,
    onEmpty: can("planning.book", { dept: m.deptCode }) ? (date: string, minute: number) => setSlot({ machine: m, date, minute }) : undefined,
  });

  return (
    <div className="flex flex-col gap-4" aria-busy={pending}>
      {/* Controls */}
      <div className="flex flex-col gap-3 rounded-2xl border bg-card p-3">
        <DeptChips choice={choice} />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="icon-sm" aria-label="Previous week" onClick={() => set({ date: dayPlus(week, -7) })}>
            <ChevronLeft aria-hidden />
          </Button>
          <Button variant="outline" size="sm" onClick={() => set({ date: null })}>
            Today
          </Button>
          <Button variant="outline" size="icon-sm" aria-label="Next week" onClick={() => set({ date: dayPlus(week, 7) })}>
            <ChevronRight aria-hidden />
          </Button>
          <label className="flex items-center gap-1.5">
            <CalendarDays className="size-4 text-muted-foreground" aria-hidden />
            <span className="sr-only">Go to date</span>
            <Input type="date" className="h-9 w-40" value={week} onChange={(e) => e.target.value && set({ date: e.target.value })} />
          </label>
          <span className="text-sm font-medium">
            {shortDate(week)} to {shortDate(dayPlus(week, 6))}
          </span>
          <label className="flex items-center gap-2 text-sm sm:ml-auto">
            <Switch checked={full24} onCheckedChange={(on) => set({ full: on ? "1" : null })} />
            Show full 24 hours
          </label>
          {pending ? <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden /> : null}
        </div>
      </div>

      <p className="text-sm font-medium" aria-live="polite">
        {boardSummary(data.summary.running, data.summary.free, data.summary.weekPct)}
      </p>

      {!data.machines.length ? (
        <p className="rounded-2xl border bg-card p-6 text-center text-muted-foreground">No machines in this department.</p>
      ) : (
        <>
          {/* Laptops: a card per machine */}
          <div className="hidden gap-4 md:grid md:grid-cols-2 xl:grid-cols-3">
            {data.machines.map((m) => (
              <section key={m.id} className="min-w-0 rounded-2xl border bg-card p-3" aria-label={m.name}>
                <CardHeader m={m} week={week} />
                <WeekGrid {...forMachine(m)} size="mini" />
              </section>
            ))}
          </div>
          {/* Phones: one machine, one day */}
          <PhoneBoard data={data} forMachine={forMachine} />
        </>
      )}

      {slot ? (
        <JobPicker
          slot={slot}
          jobs={data.toPlan.filter((j) => j.deptCode === slot.machine.deptCode)}
          onClose={() => setSlot(null)}
          onPicked={(job) => {
            setBooking({ job, machineId: slot.machine.id, start: `${slot.date}T${hhmm(slot.minute)}` });
            setSlot(null);
          }}
        />
      ) : null}
      {booking ? <BookTimeDialog open onOpenChange={(o) => !o && setBooking(null)} job={booking.job} options={data.options} preset={{ machineId: booking.machineId, start: booking.start }} onDone={() => router.refresh()} /> : null}
    </div>
  );
}

function CardHeader({ m, week }: { m: Machine; week: string }) {
  return (
    <Link href={`/planning/machines/${m.id}?week=${week}`} className="mb-2 block rounded-lg p-1 hover:bg-secondary/60">
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="min-w-0 font-semibold text-primary">{m.name}</span>
        <span className="text-xs text-muted-foreground tabular-nums">{m.code}</span>
        <MachineStatusChip status={m.status} />
      </span>
      <span className="mt-0.5 flex flex-wrap items-center justify-between gap-x-2 text-xs">
        <span className={cn(m.now ? (m.now.running ? "font-medium text-emerald-700" : "text-foreground") : "text-muted-foreground")}>
          {m.now ? `Now: ${m.now.ticketNo.split("/").pop()}${m.now.operator ? ` (${m.now.operator.split(" ")[0]})` : ""}` : "Free"}
        </span>
        <span className="text-muted-foreground">This week: {pctText(m.usePct)}</span>
      </span>
    </Link>
  );
}

function PhoneBoard({ data, forMachine }: { data: DepartmentBoardData; forMachine: (m: Machine) => Parameters<typeof WeekGrid>[0] extends infer P ? Omit<P & object, "size"> : never }) {
  const dates = weekDates(data.weekFrom);
  const todayIdx = dates.indexOf(data.today);
  const [day, setDay] = useState(todayIdx >= 0 ? todayIdx : 0);
  const [id, setId] = useState(data.machines[0]?.id ?? "");
  const m = data.machines.find((x) => x.id === id) ?? data.machines[0];
  const touch = useRef<number | null>(null);
  if (!m) return null;
  const move = (d: number) => setDay((x) => Math.min(6, Math.max(0, x + d)));
  return (
    <div className="flex flex-col gap-3 md:hidden">
      <Select value={m.id} onValueChange={setId}>
        <SelectTrigger className="h-11 w-full bg-card" aria-label="Machine">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {data.machines.map((x) => (
            <SelectItem key={x.id} value={x.id}>
              {x.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <section className="rounded-2xl border bg-card p-3" aria-label={m.name}>
        <CardHeader m={m} week={data.weekFrom} />
        <div className="mb-2 flex items-center justify-between">
          <Button variant="outline" size="icon-sm" aria-label="Previous day" disabled={day === 0} onClick={() => move(-1)}>
            <ChevronLeft aria-hidden />
          </Button>
          <span className="text-sm font-semibold">
            {DAY_NAMES[day]} {shortDate(dates[day])}
          </span>
          <Button variant="outline" size="icon-sm" aria-label="Next day" disabled={day === 6} onClick={() => move(1)}>
            <ChevronRight aria-hidden />
          </Button>
        </div>
        <div
          onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
          onTouchEnd={(e) => {
            if (touch.current == null) return;
            const dx = e.changedTouches[0].clientX - touch.current;
            if (Math.abs(dx) > 50) move(dx < 0 ? 1 : -1);
            touch.current = null;
          }}
        >
          <WeekGrid {...forMachine(m)} size="day" days={[day]} />
        </div>
      </section>
    </div>
  );
}

/** "Which job?" for an empty hour: the department's jobs still to plan, then Book time. */
function JobPicker({ slot, jobs, onClose, onPicked }: { slot: { machine: Machine; date: string; minute: number }; jobs: DepartmentBoardData["toPlan"]; onClose: () => void; onPicked: (job: BookJob) => void }) {
  const [pending, start] = useTransition();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Book {slot.machine.name}</DialogTitle>
          <DialogDescription>
            {DAY_NAMES[(new Date(`${slot.date}T00:00:00Z`).getUTCDay() + 6) % 7]} {shortDate(slot.date)} at {hhmm(slot.minute)}. Which job?
          </DialogDescription>
        </DialogHeader>
        {jobs.length ? (
          <ul className="flex flex-col gap-2">
            {jobs.map((j) => (
              <li key={j.id}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await loadBookJobAction(j.id);
                      if (!r.ok) return void toast.error(r.message);
                      onPicked(r.data);
                    })
                  }
                  className="w-full rounded-xl border p-3 text-left text-sm hover:border-primary/40"
                >
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="font-semibold tabular-nums">{j.ticketNo.split("/").pop()}</span>
                    {j.urgent ? <span className="rounded bg-red-100 px-1 text-xs font-semibold text-red-800">Urgent</span> : null}
                    {j.waitingForPo ? <span className="rounded bg-amber-100 px-1 text-xs text-amber-900">No PO yet</span> : null}
                  </span>
                  <span className="block">{j.company}</span>
                  <span className="block text-muted-foreground">
                    {j.service}
                    {j.unplanned != null ? ` · ${formatHours(j.unplanned)} to plan` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Nothing in {slot.machine.deptCode} is waiting to be planned. To move an existing booking, open its job.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
