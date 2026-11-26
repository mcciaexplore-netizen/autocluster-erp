"use client";

import Link from "next/link";
import { useMemo, useRef } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { JOB_STATUS_UI } from "@/lib/planning/job-status";
import { BLOCK_TYPES } from "@/lib/validation/planning";
import { bookedHoursByDay, daySegments, hourLabels, hoursText, nonWorking, visibleRange, weekDates, workingParts } from "@/lib/planning/board";
import { bookingColour, BLOCKED_STYLE } from "@/lib/planning/booking-colour";
import { formatWhen, hhmm, type WorkPattern } from "@/lib/planning/hours";
import { cn } from "@/lib/utils";

export type GridBooking = {
  id: string;
  jobId: string;
  start: string;
  end: string;
  ticketNo: string;
  company: string;
  service: string;
  operator: string | null;
  status: string;
  tentative: boolean;
  holdExpired: boolean;
  late: boolean;
};
export type GridBlock = { id: string; type: string; start: string; end: string; note: string | null };

export interface WeekGridProps {
  machine: { id: string; runsNonstop: boolean };
  weekFrom: string;
  today: string;
  nowIso: string;
  hours: { days: number[]; shiftStart: number; shiftEnd: number; breakStart: number | null; breakEnd: number | null };
  holidays: { date: string; name: string }[];
  allHolidays: string[];
  bookings: GridBooking[];
  blocks: GridBlock[];
  full24: boolean;
  /** mini: the board (1 hour = 13 px); day: phones (1 hour = 36 px); full: the machine page (30-minute rows). */
  size: "mini" | "day" | "full";
  /** Which days to show (0 = Monday); all 7 by default. */
  days?: number[];
  /** Clicking an empty hour (only when they may book). */
  onEmpty?: (date: string, minute: number) => void;
  /** Full size: drag a booking to another time or day (the parent moves it with the usual rules). */
  onMove?: (b: GridBooking, date: string, minute: number) => void;
}

const PX_PER_HOUR = { mini: 13, day: 36, full: 48 } as const;
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const STATUS_LABEL = (s: string) => (s in JOB_STATUS_UI ? JOB_STATUS_UI[s as keyof typeof JOB_STATUS_UI].label : s);

/** Side by side when bookings overlap (machines that run jobs in parallel). */
function lanes(segs: { key: string; startMin: number; endMin: number }[]) {
  const sorted = [...segs].sort((a, b) => a.startMin - b.startMin);
  const laneEnd: number[] = [];
  const lane = new Map<string, number>();
  for (const s of sorted) {
    let i = laneEnd.findIndex((e) => e <= s.startMin);
    if (i < 0) i = laneEnd.push(0) - 1;
    laneEnd[i] = s.endMin;
    lane.set(s.key, i);
  }
  return { lane, count: Math.max(1, laneEnd.length) };
}

export function WeekGrid(p: WeekGridProps) {
  const pattern: WorkPattern = useMemo(() => ({ ...p.hours, holidays: new Set(p.allHolidays) }), [p.hours, p.allHolidays]);
  const dates = weekDates(p.weekFrom);
  const showDays = p.days ?? [0, 1, 2, 3, 4, 5, 6];
  const bSegs = p.bookings.flatMap((b) => daySegments(b.start, b.end, p.weekFrom).map((g) => ({ ...g, b })));
  const kSegs = p.blocks.flatMap((k) => daySegments(k.start, k.end, p.weekFrom).map((g) => ({ ...g, k })));
  const range = visibleRange(p.machine, pattern, p.full24);
  const pxH = PX_PER_HOUR[p.size];
  const height = ((range.to - range.from) / 60) * pxH;
  const y = (min: number) => ((Math.max(range.from, Math.min(range.to, min)) - range.from) / 60) * pxH;
  const perDay = bookedHoursByDay(workingParts(bSegs, p.weekFrom, pattern, p.machine.runsNonstop));
  const holidayName = new Map(p.holidays.map((h) => [h.date, h.name]));
  const now = new Date(p.nowIso);
  const nowMin = Math.round((now.getTime() - new Date(`${p.today}T00:00:00+05:30`).getTime()) / 60_000);
  const step = p.size === "full" ? 30 : 60;
  const labelW = p.size === "mini" ? "w-8" : "w-11";
  const text = p.size === "mini" ? "text-[9px]" : "text-xs";

  const clickEmpty = (date: string, e: React.MouseEvent<HTMLDivElement>) => {
    if (!p.onEmpty) return;
    const r = e.currentTarget.getBoundingClientRect();
    const min = range.from + Math.floor((((e.clientY - r.top) / pxH) * 60) / step) * step;
    p.onEmpty(date, Math.min(range.to - step, Math.max(range.from, min)));
  };

  return (
    <div className={cn("select-none", text)}>
      {/* Day names */}
      <div className="flex">
        <div className={cn("shrink-0", labelW)} />
        {showDays.map((d) => (
          <div key={d} title={holidayName.get(dates[d]) ? `Holiday: ${holidayName.get(dates[d])}` : undefined} className={cn("min-w-0 flex-1 truncate pb-1 text-center font-medium text-muted-foreground", dates[d] === p.today && "text-primary", holidayName.has(dates[d]) && "text-amber-700")}>
            {DAY_NAMES[d]} {Number(dates[d].slice(8))}
          </div>
        ))}
      </div>
      <div className="flex">
        {/* Hours down the side, every 2 hours */}
        <div className={cn("relative shrink-0", labelW)} style={{ height }}>
          {hourLabels(range).map((m) => (
            <span key={m} className="absolute right-1 -translate-y-1/2 text-muted-foreground tabular-nums" style={{ top: y(m) }}>
              {hhmm(m % 1440).slice(0, 5)}
            </span>
          ))}
        </div>
        {showDays.map((d) => {
          const date = dates[d];
          const holiday = holidayName.get(date);
          const daysB = bSegs.filter((g) => g.day === d);
          const { lane, count } = lanes(daysB.map((g) => ({ key: g.b.id, startMin: g.startMin, endMin: g.endMin })));
          return (
            <div
              key={d}
              role={p.onEmpty ? "button" : undefined}
              aria-label={p.onEmpty ? `Book ${DAY_NAMES[d]} ${date}` : undefined}
              onClick={(e) => clickEmpty(date, e)}
              title={holiday ? `Holiday: ${holiday}` : undefined}
              className={cn("relative min-w-0 flex-1 border-l border-slate-200 first:border-l-0", p.onEmpty && "cursor-cell", holiday && "bg-amber-50")}
              style={{ height }}
            >
              {/* Hour lines */}
              {Array.from({ length: Math.round((range.to - range.from) / step) }, (_, i) => (
                <div key={i} className={cn("absolute inset-x-0 border-t", (range.from + i * step) % 60 === 0 ? "border-slate-200" : "border-dashed border-slate-100")} style={{ top: (i * step * pxH) / 60 }} />
              ))}
              {/* Non-working time */}
              {nonWorking(date, pattern, p.machine.runsNonstop).map((w, i) => (
                <div key={i} className="pointer-events-none absolute inset-x-0 bg-slate-100/80" style={{ top: y(w.startMin), height: Math.max(0, y(w.endMin) - y(w.startMin)) }} />
              ))}
              {/* Blocked time */}
              {kSegs
                .filter((g) => g.day === d)
                .map((g) => (
                  <div
                    key={`${g.k.id}-${d}`}
                    title={`${BLOCK_TYPES[g.k.type as keyof typeof BLOCK_TYPES] ?? "Not available"}${g.k.note ? `: ${g.k.note}` : ""}\n${formatWhen(new Date(g.k.start))} to ${formatWhen(new Date(g.k.end))}`}
                    className={cn("absolute inset-x-0.5 overflow-hidden rounded-sm border", BLOCKED_STYLE)}
                    style={{ top: y(g.startMin), height: Math.max(3, y(g.endMin) - y(g.startMin)) }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {p.size !== "mini" ? <span className="px-1">{BLOCK_TYPES[g.k.type as keyof typeof BLOCK_TYPES] ?? "Not available"}</span> : null}
                  </div>
                ))}
              {/* Bookings */}
              {daysB.map((g) => {
                const h = Math.max(p.size === "mini" ? 4 : 14, y(g.endMin) - y(g.startMin));
                const l = lane.get(g.b.id) ?? 0;
                return (
                  <BookingBlock
                    key={`${g.b.id}-${d}`}
                    b={g.b}
                    size={p.size}
                    style={{ top: y(g.startMin), height: h, left: `calc(${(l / count) * 100}% + 1px)`, width: `calc(${100 / count}% - 2px)` }}
                    draggable={!!p.onMove && !["DONE", "HANDED_OVER", "RUNNING"].includes(g.b.status) && new Date(g.b.start) > now}
                    onDragEndAt={(dy, dayShift) => {
                      if (!p.onMove) return;
                      const min = Math.round((g.startMin + (dy / pxH) * 60) / step) * step;
                      const target = Math.min(6, Math.max(0, d + dayShift));
                      p.onMove(g.b, dates[target], Math.max(0, Math.min(1440 - step, min)));
                    }}
                  />
                );
              })}
              {/* Now */}
              {date === p.today && nowMin >= range.from && nowMin <= range.to ? <div className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-red-500" style={{ top: y(nowMin) }} aria-label="Now" /> : null}
            </div>
          );
        })}
      </div>
      {/* Hours booked per day */}
      <div className="mt-1 flex border-t pt-1">
        <div className={cn("shrink-0 text-muted-foreground", labelW)} />
        {showDays.map((d) => (
          <div key={d} className="min-w-0 flex-1 truncate text-center font-medium text-muted-foreground tabular-nums">
            {hoursText(perDay[d])}
          </div>
        ))}
      </div>
    </div>
  );
}

function BookingBlock({ b, size, style, draggable, onDragEndAt }: { b: GridBooking; size: WeekGridProps["size"]; style: React.CSSProperties; draggable: boolean; onDragEndAt: (dy: number, dayShift: number) => void }) {
  const times = `${hhmm(minOfDay(b.start)).slice(0, 5)}-${hhmm(minOfDay(b.end)).slice(0, 5)}`;
  const short = b.ticketNo.split("/").pop();
  const startAt = useRef({ x: 0, y: 0 });
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          draggable={draggable}
          onDragStart={(e) => {
            startAt.current = { x: e.clientX, y: e.clientY };
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragEnd={(e) => {
            if (!draggable || !e.clientY) return;
            // Up and down moves the time; left and right moves it to another day column.
            const colW = e.currentTarget.parentElement?.getBoundingClientRect().width ?? 1;
            onDragEndAt(e.clientY - startAt.current.y, Math.round((e.clientX - startAt.current.x) / colW));
          }}
          title={`${b.ticketNo} · ${b.company}\n${times}${b.operator ? ` · ${b.operator}` : ""}`}
          aria-label={`${b.ticketNo}, ${b.company}, ${times}`}
          className={cn("absolute z-[5] overflow-hidden rounded-sm border text-left leading-tight shadow-sm", bookingColour(b), b.late && "ring-2 ring-red-600", draggable && "cursor-grab")}
          style={style}
        >
          {size === "mini" ? (
            Number(style.height) >= 16 ? <span className="block truncate px-0.5 font-semibold tabular-nums">{short}</span> : null
          ) : (
            <span className="block px-1 py-0.5">
              <span className="block truncate font-semibold tabular-nums">{short}</span>
              {Number(style.height) >= 34 ? <span className="block truncate">{b.company}</span> : null}
              {Number(style.height) >= 48 ? <span className="block truncate tabular-nums opacity-80">{times}</span> : null}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 text-sm" onClick={(e) => e.stopPropagation()}>
        <p className="font-semibold tabular-nums">{b.ticketNo}</p>
        <p>{b.company}</p>
        <p className="text-muted-foreground">{b.service}</p>
        <dl className="mt-2 grid grid-cols-[5rem_1fr] gap-y-1">
          <dt className="text-muted-foreground">Time</dt>
          <dd className="tabular-nums">
            {formatWhen(new Date(b.start))} to {formatWhen(new Date(b.end))}
          </dd>
          <dt className="text-muted-foreground">Operator</dt>
          <dd>{b.operator ?? "Not chosen"}</dd>
          <dt className="text-muted-foreground">Status</dt>
          <dd>
            {b.tentative ? "Tentative: waiting for PO" : STATUS_LABEL(b.status)}
            {b.late ? <span className="ml-1 font-medium text-red-700">· Late</span> : null}
          </dd>
        </dl>
        <Link href={`/planning/jobs?job=${b.jobId}`} className="mt-3 inline-block font-medium text-primary underline-offset-4 hover:underline">
          Open job
        </Link>
      </PopoverContent>
    </Popover>
  );
}

/** Minutes from India midnight of that moment. */
function minOfDay(iso: string) {
  const d = new Date(new Date(iso).getTime() + 330 * 60_000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}
