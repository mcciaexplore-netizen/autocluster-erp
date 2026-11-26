"use client";

import { bookingColour } from "@/lib/planning/booking-colour";
import { DeptChips } from "@/components/planning/dept-chips";
import type { DeptChoice } from "@/lib/planning/dept-scope";
import { DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, GripVertical, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { loadBookJobAction, moveBookingAction } from "@/lib/actions/jobs";
import { formatDate } from "@/lib/format";
import type { TimelineData } from "@/lib/planning-data";
import { dayPlus, formatHours, formatWhen, hhmm, istAt, istDate, istMinutes, patternFromSettings, segmentsOn, workingMinutesBetween } from "@/lib/planning/hours";
import { useCan } from "@/components/auth/permissions-provider";
import { cn } from "@/lib/utils";
import { BLOCK_TYPES } from "@/lib/validation/planning";
import { localValue } from "./block-time";
import { BookTimeDialog, type BookJob } from "./book-time";

const noop = () => () => {};

type Booking = TimelineData["bookings"][number];
type Job = TimelineData["toPlan"][number];

/** Smallest pixels per hour for each view; week views stretch to fill the space they have. */
const PPH = { day: 64, week: 3, "2w": 1.5 } as const;
const LABEL = 224;
const HOUR = 3_600_000;
const LANE = 30;
const ALL = "all";

/** Gives overlapping bookings their own lane (for machines that take several jobs at once). */
function lanes(list: Booking[]) {
  const ends: number[] = [];
  const out = new Map<string, number>();
  for (const b of [...list].sort((a, c) => a.start.localeCompare(c.start))) {
    const s = new Date(b.start).getTime();
    let lane = ends.findIndex((e) => e <= s);
    if (lane === -1) lane = ends.length;
    ends[lane] = new Date(b.end).getTime();
    out.set(b.id, lane);
  }
  return { lane: out, count: Math.max(1, ends.length) };
}

export function Timeline({ data, view, date, deptChoice }: { data: TimelineData; view: "day" | "week" | "2w"; date: string; deptChoice?: DeptChoice }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [dragJob, setDragJob] = useState<Job | null>(null);
  const [booking, setBooking] = useState<{ job: BookJob; machineId: string; start: string } | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const pattern = useMemo(() => patternFromSettings(data.options.hours, data.options.hours.holidays), [data.options.hours]);
  // Week views fill the width available (measured); the day view keeps its hour scale and scrolls.
  const [boxWidth, setBoxWidth] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const measure = useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBoxWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const pph = view === "day" ? PPH.day : Math.max(PPH[view], boxWidth > LABEL ? (boxWidth - LABEL - 2) / (data.window.days * 24) : PPH[view]);
  const winStart = new Date(data.window.start).getTime();
  const width = data.window.days * 24 * pph;
  const x = (iso: string | number) => ((typeof iso === "number" ? iso : new Date(iso).getTime()) - winStart) / HOUR * pph;
  const days = Array.from({ length: data.window.days }, (_, i) => dayPlus(date, i));
  // The time "now" only in the browser (the server's page is the same for everyone), to the minute.
  const now = useSyncExternalStore(
    noop,
    () => Math.floor(Date.now() / 60_000) * 60_000,
    () => null,
  );
  const nowX = now != null && now >= winStart && now <= new Date(data.window.end).getTime() ? x(now) : null;
  // Open the day view at the current time (or 08:00).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || view !== "day") return;
    el.scrollLeft = Math.max(0, (nowX ?? 8 * pph) - 2 * pph);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, date]);

  const set = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    p.delete("job");
    router.replace(`${pathname}?${p}`, { scroll: false });
  };
  const openJob = (id: string) => {
    const p = new URLSearchParams(params);
    p.set("job", id);
    router.replace(`${pathname}?${p}`, { scroll: false });
  };
  const step = view === "day" ? 1 : view === "week" ? 7 : 14;

  const onDragStart = (e: DragStartEvent) => {
    const d = e.active.data.current as { type: string; job?: Job } | undefined;
    if (d?.type === "job") setDragJob(d.job!);
  };
  const onDragEnd = (e: DragEndEvent) => {
    setDragJob(null);
    const d = e.active.data.current as { type: "move" | "resize" | "job"; booking?: Booking; job?: Job; nonstop?: boolean };
    const snap = (ms: number) => Math.round(ms / 1_800_000) * 1_800_000;
    if (d.type === "job") {
      if (!e.over) return;
      const pointer = (e.activatorEvent as PointerEvent).clientX + e.delta.x;
      const t = winStart + ((pointer - e.over.rect.left) / pph) * HOUR;
      const machineId = String(e.over.id);
      start(async () => {
        const r = await loadBookJobAction(d.job!.id);
        if (!r.ok) return void toast.error(r.message);
        setBooking({ job: r.data, machineId, start: localValue(new Date(snap(t))) });
      });
      return;
    }
    const b = d.booking!;
    const shift = snap((e.delta.x / pph) * HOUR);
    if (d.type === "move") {
      const machineId = e.over ? String(e.over.id) : b.machineId;
      if (!shift && machineId === b.machineId) return;
      const newStart = new Date(new Date(b.start).getTime() + shift).toISOString();
      start(async () => {
        const r = await moveBookingAction(b.id, { machineId, startExact: newStart, hours: b.hours });
        if (!r.ok) return void toast.error(r.message); // the bar springs back: nothing was changed
        toast.success(`${b.ticketNo} moved to ${r.data.machine}: ${formatWhen(new Date(r.data.start))} to ${formatWhen(new Date(r.data.end))}`, r.data.warning ? { description: r.data.warning } : undefined);
        router.refresh();
      });
    } else {
      if (!shift) return;
      const newEnd = new Date(new Date(b.end).getTime() + shift);
      const minutes = workingMinutesBetween(new Date(b.start), newEnd, pattern, !!d.nonstop);
      const hours = Math.max(0.5, Math.round((minutes / 60) * 2) / 2);
      if (hours === b.hours) return;
      start(async () => {
        const r = await moveBookingAction(b.id, { hours });
        if (!r.ok) return void toast.error(r.message);
        toast.success(`${b.ticketNo}: now ${formatHours(hours)}, ends ${formatWhen(new Date(r.data.end))}`);
        router.refresh();
      });
    }
  };

  const filterSel = (k: string, label: string, opts: { value: string; label: string }[], any: string) => (
    <Select value={params.get(k) ?? ALL} onValueChange={(v) => set({ [k]: v === ALL ? null : v })}>
      <SelectTrigger className="h-9 w-40 bg-card text-sm" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{any}</SelectItem>
        {opts.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  const chip = (k: string, label: string) => {
    const on = params.get(k) === "1";
    return (
      <button type="button" aria-pressed={on} onClick={() => set({ [k]: on ? null : "1" })} className={cn("h-9 rounded-full border px-3 text-sm font-medium", on ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-secondary")}>
        {label}
      </button>
    );
  };

  const groups = data.departments.map((d) => ({ d, ms: data.machines.filter((m) => m.deptCode === d.code) })).filter((g) => g.ms.length);
  const rangeText = view === "day" ? formatWhen(istAt(date, 0)).split(",")[0] : `${formatDate(date)} to ${formatDate(dayPlus(date, data.window.days - 1))}`;

  return (
    <div className={cn("flex flex-col gap-4", pending && "cursor-progress")}>
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-card p-3">
        <div className="flex rounded-xl bg-secondary p-1" role="group" aria-label="View">
          {(["day", "week", "2w"] as const).map((v) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => set({ view: v })} className={cn("h-8 rounded-lg px-3 text-sm font-medium", view === v ? "bg-card text-primary shadow-sm" : "text-muted-foreground")}>
              {v === "day" ? "Day" : v === "week" ? "Week" : "2 weeks"}
            </button>
          ))}
        </div>
        <Button variant="outline" size="icon-sm" aria-label="Earlier" onClick={() => set({ date: dayPlus(date, -step) })}>
          <ChevronLeft aria-hidden />
        </Button>
        <Button variant="outline" size="sm" onClick={() => set({ date: null })}>
          Today
        </Button>
        <Button variant="outline" size="icon-sm" aria-label="Later" onClick={() => set({ date: dayPlus(date, step) })}>
          <ChevronRight aria-hidden />
        </Button>
        <label className="flex items-center gap-1.5">
          <CalendarDays className="size-4 text-muted-foreground" aria-hidden />
          <span className="sr-only">Go to date</span>
          <Input type="date" className="h-9 w-40" value={date} onChange={(e) => e.target.value && set({ date: e.target.value })} />
        </label>
        <span className="text-sm font-medium">{rangeText}</span>
        <div className="flex w-full flex-wrap items-center gap-2 lg:ml-auto lg:w-auto">
          {deptChoice ? <DeptChips choice={deptChoice} /> : null}
          {filterSel("machine", "Machine", data.allMachines.map((m) => ({ value: m.id, label: m.name })), "All machines")}
          {filterSel("operator", "Operator", data.options.team.map((t) => ({ value: t.id, label: t.name })), "Any operator")}
          {filterSel("customer", "Customer", data.customers.map((c) => ({ value: c.id, label: c.name })), "Any customer")}
          {chip("late", "Late only")}
          {chip("tentative", "Tentative only")}
          {["machine", "operator", "customer", "late", "tentative"].some((k) => params.get(k)) ? (
            <Button variant="ghost" size="sm" onClick={() => set({ machine: null, operator: null, customer: null, late: null, tentative: null })}>
              <X aria-hidden /> Clear
            </Button>
          ) : null}
        </div>
      </div>

      <Legend />

      <DndContext id="planning-timeline" sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} autoScroll={{ threshold: { x: 0.08, y: 0.04 } }}>
        <div className="flex gap-4">
          {/* To plan */}
          <aside className="hidden w-64 shrink-0 flex-col gap-3 xl:flex" aria-labelledby="toplan-h">
            <h2 id="toplan-h" className="font-semibold">
              To plan <span className="text-sm font-normal text-muted-foreground">({data.toPlan.length})</span>
            </h2>
            <p className="text-xs text-muted-foreground">Drag a job onto a machine to book it.</p>
            <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto pr-1">
              {data.departments.map((d) => {
                const js = data.toPlan.filter((j) => (j.deptCode ?? "") === d.code);
                return js.length ? (
                  <div key={d.code}>
                    <p className="mb-1.5 text-xs font-semibold text-muted-foreground">{d.code}</p>
                    <ul className="flex flex-col gap-1.5">
                      {js.map((j) => (
                        <JobCard key={j.id} job={j} onOpen={() => openJob(j.id)} />
                      ))}
                    </ul>
                  </div>
                ) : null;
              })}
              {data.toPlan.filter((j) => !data.departments.some((d) => d.code === j.deptCode)).map((j) => (
                <JobCard key={j.id} job={j} onOpen={() => openJob(j.id)} />
              ))}
              {!data.toPlan.length ? <p className="text-sm text-muted-foreground">Nothing waiting to be planned.</p> : null}
            </div>
          </aside>

          {/* The timeline (desktop) */}
          <div ref={measure} className="hidden min-w-0 flex-1 overflow-x-auto rounded-2xl border bg-card md:block">
            <div style={{ width: width + LABEL }} className="relative">
              {/* header */}
              <div className="sticky top-0 z-20 flex border-b bg-card">
                <div className="sticky left-0 z-30 w-56 shrink-0 border-r bg-card px-3 py-2 text-xs font-semibold text-muted-foreground">Machine</div>
                <div className="relative h-10" style={{ width }}>
                  {days.map((d, i) => (
                    <div key={d} className={cn("absolute top-0 h-full border-l px-1.5 text-xs", d === istDate(new Date()) ? "font-semibold text-primary" : "text-muted-foreground")} style={{ left: i * 24 * pph, width: 24 * pph }}>
                      {view === "day" ? (
                        Array.from({ length: 24 }, (_, h) => (
                          <span key={h} className="absolute top-2.5 border-l pl-1" style={{ left: h * pph }}>
                            {hhmm(h * 60)}
                          </span>
                        ))
                      ) : (
                        <span className="block truncate pt-2.5">{view === "week" ? formatWhen(istAt(d, 0)).split(",")[0] : `${formatWhen(istAt(d, 0)).slice(0, 1)} ${Number(d.slice(8))}`}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              {groups.map(({ d, ms }) => {
                const closed = collapsed.includes(d.code);
                return (
                  <div key={d.code}>
                    <button
                      type="button"
                      onClick={() => setCollapsed((c) => (closed ? c.filter((x) => x !== d.code) : [...c, d.code]))}
                      aria-expanded={!closed}
                      className="sticky left-0 z-10 flex w-56 items-center gap-1.5 border-b bg-secondary px-3 py-1.5 text-left text-xs font-semibold"
                    >
                      <ChevronDown className={cn("size-3.5 transition", closed && "-rotate-90")} aria-hidden />
                      {d.code} - {d.name} ({ms.length})
                    </button>
                    {!closed
                      ? ms.map((m) => (
                          <MachineRow
                            key={m.id}
                            machine={m}
                            days={days}
                            width={width}
                            x={x}
                            pph={pph}
                            bookings={data.bookings.filter((b) => b.machineId === m.id)}
                            blocks={data.blocks.filter((b) => b.machineId === m.id)}
                            shade={(day) => (m.runsNonstop ? [] : offSpans(day, pattern))}
                            onOpen={openJob}
                          />
                        ))
                      : null}
                  </div>
                );
              })}
              {!groups.length ? <p className="p-6 text-sm text-muted-foreground">No machines match the filters.</p> : null}
              {nowX != null ? <div className="pointer-events-none absolute top-0 bottom-0 z-10 w-0.5 bg-red-500" style={{ left: LABEL + nowX }} aria-label="Now" /> : null}
            </div>
          </div>

          {/* Phone: day list per machine */}
          <PhoneAgenda data={data} date={date} onOpen={openJob} />
        </div>
        <DragOverlay dropAnimation={null}>{dragJob ? <div className="w-60 rounded-lg border border-primary bg-card p-2 text-sm shadow-lg">{dragJob.ticketNo} · {dragJob.company}</div> : null}</DragOverlay>
      </DndContext>

      {booking ? <BookTimeDialog open onOpenChange={(o) => !o && setBooking(null)} job={booking.job} options={data.options} preset={{ machineId: booking.machineId, start: booking.start }} /> : null}
    </div>
  );
}

/** Non-working minutes of a day (shaded): before the shift, the break, after the shift; all day on days off. */
function offSpans(day: string, pattern: ReturnType<typeof patternFromSettings>): [number, number][] {
  const segs = segmentsOn(day, pattern);
  if (!segs.length) return [[0, 1440]];
  const out: [number, number][] = [];
  let t = 0;
  for (const [s, e] of segs) {
    if (s > t) out.push([t, s]);
    t = e;
  }
  if (t < 1440) out.push([t, 1440]);
  return out;
}

function MachineRow({
  machine: m,
  days,
  width,
  x,
  pph,
  bookings,
  blocks,
  shade,
  onOpen,
}: {
  machine: TimelineData["machines"][number];
  days: string[];
  width: number;
  x: (iso: string | number) => number;
  pph: number;
  bookings: Booking[];
  blocks: TimelineData["blocks"];
  shade: (day: string) => [number, number][];
  onOpen: (jobId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: m.id });
  const { lane, count } = lanes(bookings);
  const height = count * LANE + 10;
  return (
    <div className="flex border-b">
      <div className="sticky left-0 z-10 flex w-56 shrink-0 flex-col justify-center border-r bg-card px-3 py-1" style={{ minHeight: height }}>
        <span className="truncate text-sm font-medium" title={m.name}>
          {m.name}
        </span>
        <span className="text-xs text-muted-foreground">
          {m.code}
          {m.runsNonstop ? " · day and night" : ""}
          {m.parallelJobs > 1 ? ` · ${m.parallelJobs} at once` : ""}
          {m.status === "BREAKDOWN" ? <span className="font-semibold text-red-700"> · broken down</span> : null}
        </span>
      </div>
      <div ref={setNodeRef} className={cn("relative", isOver && "bg-primary/5")} style={{ width, height }}>
        {days.map((d, i) =>
          shade(d).map(([a, b]) => <div key={`${d}${a}`} className="absolute top-0 h-full bg-slate-100" style={{ left: (i * 24 + a / 60) * pph, width: ((b - a) / 60) * pph }} aria-hidden />),
        )}
        {days.map((d, i) => (
          <div key={d} className="absolute top-0 h-full border-l border-slate-200" style={{ left: i * 24 * pph }} aria-hidden />
        ))}
        {blocks.map((b) => (
          <div
            key={b.id}
            title={`${BLOCK_TYPES[b.type]}${b.note ? `: ${b.note}` : ""} (${formatWhen(new Date(b.start))} to ${formatWhen(new Date(b.end))})`}
            className="absolute top-1 bottom-1 overflow-hidden rounded border border-slate-400 bg-[repeating-linear-gradient(135deg,#e2e8f0_0_5px,#cbd5e1_5px_10px)] px-1 text-[11px] text-slate-700"
            style={{ left: Math.max(0, x(b.start)), width: Math.max(4, Math.min(width, x(b.end)) - Math.max(0, x(b.start))) }}
          >
            {BLOCK_TYPES[b.type]}
          </div>
        ))}
        {bookings.map((b) => (
          <Bar key={b.id} b={b} x={x} width={width} top={5 + (lane.get(b.id) ?? 0) * LANE} nonstop={m.runsNonstop} onOpen={() => onOpen(b.jobId)} pph={pph} dept={m.deptCode} />
        ))}
      </div>
    </div>
  );
}

/** The narrowest a booking is drawn, so its ticket number stays readable. */
const MIN_BAR_PX = 36;

function Bar({ b, x, width, top, nonstop, onOpen, pph, dept }: { b: Booking; x: (iso: string) => number; width: number; top: number; nonstop: boolean; onOpen: () => void; pph: number; dept: string }) {
  const started = new Date(b.start) <= new Date();
  const done = ["DONE", "HANDED_OVER"].includes(b.status);
  // Moving and resizing need "planning.book" for this machine's department (the server checks again).
  const canBook = useCan()("planning.book", { dept });
  const { setNodeRef, attributes, listeners, transform, isDragging } = useDraggable({ id: `move:${b.id}`, data: { type: "move", booking: b }, disabled: started || done || !canBook });
  const { setNodeRef: setResizeRef, attributes: resizeAttributes, listeners: resizeListeners, transform: resizeTransform } = useDraggable({ id: `resize:${b.id}`, data: { type: "resize", booking: b, nonstop }, disabled: done || !canBook });
  const left = Math.max(0, x(b.start));
  const right = Math.min(width, x(b.end));
  // Very short bookings keep a readable minimum width (ticket no. visible; full details on hover).
  const w = Math.max(MIN_BAR_PX, right - left + (resizeTransform?.x ?? 0));
  const colour = bookingColour(b);
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
      title={`${b.ticketNo} · starts ${formatWhen(new Date(b.start))}\n${b.company} · ${b.service}\n${formatWhen(new Date(b.start))} to ${formatWhen(new Date(b.end))} (${formatHours(b.hours)})${b.operator ? `\n${b.operator}` : ""}${b.tentative ? `\nTentative: waiting for PO (held until ${b.holdUntil?.split("-").reverse().join("/")})` : ""}${b.late ? "\nLate: past the promised date" : ""}${b.overrun ? "\nStill running? Past its booked end" : ""}`}
      className={cn("absolute z-[5] flex items-center overflow-hidden rounded-md border text-[11px] leading-tight shadow-sm select-none", colour, b.late && "ring-2 ring-red-600", b.overrun && "animate-pulse ring-2 ring-red-600", !started && !done && canBook && "cursor-grab", isDragging && "z-30 opacity-80 shadow-lg")}
      style={{ left, width: w, top, height: LANE - 4, transform: CSS.Translate.toString(transform) }}
    >
      <span className="truncate px-1.5">
        <span className="font-semibold tabular-nums">{b.ticketNo.split("/").pop()}</span> {pph >= 8 || w > 120 ? `${b.company} · ${b.service}` : ""}
      </span>
      {!done && canBook && w >= 20 ? (
        <span
          ref={setResizeRef}
          {...resizeAttributes}
          {...resizeListeners}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Change the hours of ${b.ticketNo}`}
          className="absolute top-0 right-0 h-full w-1.5 cursor-ew-resize bg-black/10 hover:bg-black/25"
        />
      ) : null}
    </div>
  );
}

function JobCard({ job: j, onOpen }: { job: Job; onOpen: () => void }) {
  const canBook = useCan()("planning.book", { dept: j.deptCode });
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: `job:${j.id}`, data: { type: "job", job: j }, disabled: !canBook });
  return (
    <li ref={setNodeRef} className={cn("flex items-start gap-1 rounded-lg border bg-card p-2 text-xs", isDragging && "opacity-40", j.late && "border-red-300")}>
      <span {...attributes} {...listeners} className="mt-0.5 cursor-grab text-muted-foreground" aria-label={`Drag ${j.ticketNo} onto a machine`}>
        <GripVertical className="size-4" aria-hidden />
      </span>
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span className="flex flex-wrap items-center gap-1">
          <span className="font-semibold tabular-nums">{j.ticketNo.split("/").pop()}</span>
          {j.urgent ? <span className="rounded bg-red-100 px-1 font-semibold text-red-800">Urgent</span> : null}
          {j.waitingForPo ? <span className="rounded bg-amber-100 px-1 text-amber-900">No PO yet</span> : null}
        </span>
        <span className="block truncate">{j.company}</span>
        <span className="block truncate text-muted-foreground">{j.service}</span>
        <span className={cn("block", j.late ? "font-semibold text-red-700" : "text-muted-foreground")}>
          {j.unplanned != null ? `${formatHours(j.unplanned)} to plan` : "Time needed not set"}
          {j.promisedDate ? ` · promised ${formatDate(j.promisedDate)}` : ""}
        </span>
      </button>
    </li>
  );
}

function Legend() {
  const item = (cls: string, label: string) => (
    <li className="flex items-center gap-1.5">
      <span className={cn("inline-block h-3 w-5 rounded-sm border", cls)} aria-hidden />
      {label}
    </li>
  );
  return (
    <ul className="hidden flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground md:flex" aria-label="Colours">
      {item("border-blue-400 bg-blue-200", "Planned")}
      {item("border-emerald-500 bg-emerald-200", "Running")}
      {item("border-amber-400 bg-[repeating-linear-gradient(135deg,#fffbeb_0_3px,#fde68a_3px_6px)]", "Tentative: waiting for PO")}
      {item("border-red-500 bg-red-100", "Hold expired")}
      {item("border-blue-400 bg-blue-200 ring-2 ring-red-600", "Late (past the promised date)")}
      {item("border-slate-400 bg-[repeating-linear-gradient(135deg,#e2e8f0_0_3px,#cbd5e1_3px_6px)]", "Not available")}
      {item("border-slate-200 bg-slate-100", "Outside working hours")}
    </ul>
  );
}

/** Phones: the day's bookings per machine (book through the job panel's Book time form). */
function PhoneAgenda({ data, date, onOpen }: { data: TimelineData; date: string; onOpen: (jobId: string) => void }) {
  const [day, setDay] = useState(() => (istDate(new Date()) >= date && istDate(new Date()) < dayPlus(date, data.window.days) ? istDate(new Date()) : date));
  const start = istAt(day, 0).getTime();
  const end = istAt(dayPlus(day, 1), 0).getTime();
  const inDay = (s: string, e: string) => new Date(s).getTime() < end && new Date(e).getTime() > start;
  const days = Array.from({ length: data.window.days }, (_, i) => dayPlus(date, i));
  const t = (iso: string) => (new Date(iso).getTime() < start ? "00:00" : new Date(iso).getTime() >= end ? "24:00" : hhmm(Math.round(istMinutes(new Date(iso)))));
  return (
    <div className="flex w-full flex-col gap-3 md:hidden">
      <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {days.map((d) => (
          <button key={d} type="button" onClick={() => setDay(d)} aria-pressed={d === day} className={cn("min-h-11 shrink-0 rounded-xl border px-3 text-sm", d === day ? "border-primary bg-primary text-primary-foreground" : "bg-card")}>
            {formatWhen(istAt(d, 0)).split(",")[0]}
          </button>
        ))}
      </div>
      {data.toPlan.length ? (
        <details className="rounded-2xl border bg-card p-3">
          <summary className="cursor-pointer font-semibold">To plan ({data.toPlan.length})</summary>
          <ul className="mt-2 flex flex-col gap-2">
            {data.toPlan.map((j) => (
              <li key={j.id}>
                <button type="button" onClick={() => onOpen(j.id)} className="w-full rounded-lg border p-2 text-left text-sm">
                  <span className="font-semibold tabular-nums">{j.ticketNo}</span> {j.company}
                  <span className="block text-xs text-muted-foreground">
                    {j.service} · {j.unplanned != null ? `${formatHours(j.unplanned)} to plan` : "time not set"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {data.machines.map((m) => {
        const bs = data.bookings.filter((b) => b.machineId === m.id && inDay(b.start, b.end));
        const bl = data.blocks.filter((b) => b.machineId === m.id && inDay(b.start, b.end));
        return (
          <section key={m.id} className="rounded-2xl border bg-card p-3">
            <h3 className="text-sm font-semibold">{m.name}</h3>
            <ul className="mt-2 flex flex-col gap-1.5 text-sm">
              {bl.map((b) => (
                <li key={b.id} className="rounded-lg border border-slate-300 bg-[repeating-linear-gradient(135deg,#f1f5f9_0_6px,#e2e8f0_6px_12px)] px-2 py-1.5">
                  {t(b.start)} to {t(b.end)} · {BLOCK_TYPES[b.type]}
                </li>
              ))}
              {bs.map((b) => (
                <li key={b.id}>
                  <button type="button" onClick={() => onOpen(b.jobId)} className={cn("w-full rounded-lg border px-2 py-1.5 text-left", b.tentative ? "border-amber-300 bg-amber-50" : b.status === "RUNNING" ? "border-emerald-300 bg-emerald-50" : "border-blue-200 bg-blue-50", b.late && "ring-2 ring-red-500")}>
                    <span className="font-medium">
                      {t(b.start)} to {t(b.end)}
                    </span>{" "}
                    {b.ticketNo.split("/").pop()} · {b.company}
                    <span className="block text-xs">{b.service}</span>
                  </button>
                </li>
              ))}
              {!bs.length && !bl.length ? <li className="text-muted-foreground">Free</li> : null}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
