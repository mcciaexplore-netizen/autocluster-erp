import type { Metadata } from "next";
import { ArrowLeft, ChevronLeft, ChevronRight, Pencil } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { FormSkeleton } from "@/components/common/form-skeleton";
import { BlockTimeButton, BreakdownButton, DeleteBlockButton, FixedButton } from "@/components/planning/block-time";
import { MachineChips, MachineStatusChip, pctText } from "@/components/planning/machine-bits";
import { StillBrokenDown } from "@/components/planning/still-broken";
import { ClashActions } from "@/components/planning/clash-actions";
import { Button } from "@/components/ui/button";
import { UUID_RE } from "@/lib/inventory/uuid";
import { getMachine, type MachineDetail } from "@/lib/planning-data";
import { dayPlus, formatHours, formatWhen, hhmm, istAt, istDate, istMinutes, segmentsOn } from "@/lib/planning/hours";
import { BLOCK_TYPES } from "@/lib/validation/planning";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Machine" };

type Sp = Promise<Record<string, string | string[] | undefined>>;

export default function MachinePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Sp }) {
  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2">
        <Link href="/planning/machines">
          <ArrowLeft aria-hidden /> Machines
        </Link>
      </Button>
      <Suspense fallback={<FormSkeleton />}>
        <Detail params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

const STATUS_TEXT: Record<string, string> = { TO_PLAN: "To plan", PLANNED: "Planned", RUNNING: "Running", ON_HOLD: "On hold", DONE: "Done", HANDED_OVER: "Handed over", CANCELLED: "Cancelled" };

async function Detail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Sp }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const sp = await searchParams;
  const d = await getMachine(id, typeof sp.week === "string" ? sp.week : undefined);
  if (!d) notFound();
  const m = d.machine;
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-title text-3xl text-primary md:text-4xl">{m.name}</h1>
            <MachineStatusChip status={m.status} />
          </div>
          <p className="mt-1 text-muted-foreground">
            <span className="tabular-nums">{m.code}</span> · {d.department ? `${d.department.code} - ${d.department.name}` : m.deptCode}
            {m.makeModel ? ` · ${m.makeModel}` : ""}
            {m.location ? ` · ${m.location}` : ""}
          </p>
          <div className="mt-2">
            <MachineChips m={{ ...m, services: d.services }} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href={`/planning/machines/${m.id}/edit`}>
              <Pencil aria-hidden /> Edit
            </Link>
          </Button>
          <BlockTimeButton machineId={m.id} />
          {m.status === "BREAKDOWN" ? <FixedButton machineId={m.id} /> : m.isActive ? <BreakdownButton machineId={m.id} machineName={m.name} /> : null}
        </div>
      </header>

      {d.overdueBreakdown ? <StillBrokenDown machineId={m.id} machineName={m.name} expectedEnd={d.overdueBreakdown.toISOString()} /> : null}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Machine use">
        {[
          ["Machine use this week", pctText(d.useWeek.bookedPct), `${formatHours(d.useWeek.bookedHours)} booked of ${formatHours(d.useWeek.availableHours)}`],
          ["Machine use this month", pctText(d.useMonth.bookedPct), `${formatHours(d.useMonth.bookedHours)} booked of ${formatHours(d.useMonth.availableHours)}`],
          ["Not available this month", formatHours(d.useMonth.blockedHours), "Maintenance, calibration, breakdowns"],
          ["Jobs at the same time", String(m.parallelJobs), m.runsNonstop ? "Runs day and night" : "Follows working hours"],
        ].map(([k, v, x]) => (
          <div key={k} className="rounded-2xl border bg-card p-4">
            <p className="text-sm text-muted-foreground">{k}</p>
            <p className="mt-1 text-2xl font-semibold text-primary tabular-nums">{v}</p>
            <p className="text-xs text-muted-foreground">{x}</p>
          </div>
        ))}
      </section>

      {d.clashes.length ? (
        <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950 sm:p-5" aria-labelledby="clash-h">
          <h2 id="clash-h" className="mb-1 text-lg font-semibold">
            {d.clashes.length} {d.clashes.length === 1 ? "booking clashes" : "bookings clash"} with time it&apos;s not available
          </h2>
          <p className="mb-3 text-sm">Move each one to the next free time on this machine, or to another machine.</p>
          <ul className="flex flex-col gap-3">
            {d.clashes.map((c) => (
              <li key={c.bookingId} className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-white/70 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                <span>
                  <span className="font-semibold tabular-nums">{c.ticketNo}</span> {c.company}
                  <span className="block text-xs">
                    {formatWhen(c.startAt)} to {formatWhen(c.endAt)} · clashes with {BLOCK_TYPES[c.blockType].toLowerCase()}
                  </span>
                </span>
                <ClashActions bookingId={c.bookingId} jobId={c.jobId} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Week d={d} />

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border bg-card p-5">
          <h2 className="mb-3 text-lg font-semibold">Services it can run</h2>
          {d.services.length ? (
            <ul className="flex flex-wrap gap-2">
              {d.services.map((s) => (
                <li key={s.id} className="rounded-full border bg-secondary px-3 py-1 text-sm">
                  {s.name} <span className="text-muted-foreground">({s.deptCode})</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Not on the rate card. Jobs quoted as custom items can still be booked on it.</p>
          )}
          {m.keySpecs || m.testStandards ? (
            <dl className="mt-4 grid gap-2 text-sm">
              {m.keySpecs ? (
                <div>
                  <dt className="text-muted-foreground">Key specs</dt>
                  <dd>{m.keySpecs}</dd>
                </div>
              ) : null}
              {m.testStandards ? (
                <div>
                  <dt className="text-muted-foreground">Test standards</dt>
                  <dd>{m.testStandards}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}
        </section>
        <section className="rounded-2xl border bg-card p-5">
          <h2 className="mb-3 text-lg font-semibold">Jobs history</h2>
          {d.history.length ? (
            <ul className="divide-y text-sm">
              {d.history.map((h) => (
                <li key={h.jobId} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2">
                  <span className="min-w-0">
                    <span className="font-medium tabular-nums">{h.ticketNo}</span> <span className="text-muted-foreground">{h.company}</span>
                    <span className="block text-xs text-muted-foreground">{h.service}</span>
                  </span>
                  <span className="text-right text-xs text-muted-foreground">
                    {formatWhen(h.startAt)}
                    <span className="block">{STATUS_TEXT[h.status] ?? h.status}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No jobs on this machine yet.</p>
          )}
        </section>
      </div>
    </div>
  );
}

/** The week, Monday to Sunday: bookings and blocked time per day (in India time). */
function Week({ d }: { d: MachineDetail }) {
  const days = Array.from({ length: 7 }, (_, i) => dayPlus(d.week.from, i));
  const today = istDate(new Date());
  const range = `${formatWhen(istAt(days[0], 0)).split(",")[0]} to ${formatWhen(istAt(days[6], 0)).split(",")[0]}`;
  const items = (day: string) => {
    const start = istAt(day, 0);
    const end = istAt(dayPlus(day, 1), 0);
    const clip = (a: Date, b: Date) => `${a < start ? "00:00" : hhmm(Math.round(istMinutes(a)))} to ${b >= end ? "24:00" : hhmm(Math.round(istMinutes(b)))}`;
    return [
      ...d.week.blocks.filter((b) => b.startAt < end && b.endAt > start).map((b) => ({ key: b.id, at: b.startAt, block: b, text: clip(b.startAt, b.endAt) })),
      ...d.week.bookings.filter((b) => b.startAt < end && b.endAt > start).map((b) => ({ key: b.id, at: b.startAt, booking: b, text: clip(b.startAt, b.endAt) })),
    ].sort((a, b) => a.at.getTime() - b.at.getTime());
  };
  return (
    <section className="rounded-2xl border bg-card p-4 sm:p-5" aria-labelledby="week-h">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="week-h" className="text-lg font-semibold">
          Week of {range}
        </h2>
        <div className="flex gap-1">
          <Button asChild variant="outline" size="icon-sm" aria-label="Previous week">
            <Link href={`?week=${dayPlus(d.week.from, -7)}`} scroll={false}>
              <ChevronLeft aria-hidden />
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="?" scroll={false}>
              This week
            </Link>
          </Button>
          <Button asChild variant="outline" size="icon-sm" aria-label="Next week">
            <Link href={`?week=${dayPlus(d.week.from, 7)}`} scroll={false}>
              <ChevronRight aria-hidden />
            </Link>
          </Button>
        </div>
      </div>
      <ol className="grid gap-2 md:grid-cols-7">
        {days.map((day) => {
          const list = items(day);
          const off = !d.machine.runsNonstop && !segmentsOn(day, d.pattern).length;
          return (
            <li key={day} className={cn("min-h-28 rounded-xl border p-2", day === today && "border-primary/50 ring-1 ring-primary/20", off && "bg-secondary/60")}>
              <p className={cn("mb-1.5 text-xs font-semibold", day === today ? "text-primary" : "text-muted-foreground")}>
                {formatWhen(istAt(day, 0)).split(",")[0]}
                {off ? " · day off" : ""}
              </p>
              <ul className="flex flex-col gap-1.5">
                {list.map((it) =>
                  "block" in it && it.block ? (
                    <li key={it.key} className="flex items-start justify-between gap-1 rounded-lg border border-slate-300 bg-[repeating-linear-gradient(135deg,#f1f5f9_0_6px,#e2e8f0_6px_12px)] p-1.5 text-xs text-slate-800">
                      <span>
                        <span className="block font-medium">{BLOCK_TYPES[it.block.type]}</span>
                        {it.text}
                        {it.block.note ? <span className="block text-slate-600">{it.block.note}</span> : null}
                      </span>
                      {it.block.endAt > new Date() ? <DeleteBlockButton blockId={it.block.id} label={BLOCK_TYPES[it.block.type].toLowerCase()} /> : null}
                    </li>
                  ) : "booking" in it && it.booking ? (
                    <li key={it.key} className={cn("rounded-lg border p-1.5 text-xs", it.booking.isTentative ? "border-amber-300 bg-[repeating-linear-gradient(135deg,#fffbeb_0_6px,#fef3c7_6px_12px)] text-amber-950" : it.booking.jobStatus === "RUNNING" ? "border-emerald-300 bg-emerald-50 text-emerald-950" : "border-blue-200 bg-blue-50 text-blue-950")}>
                      <span className="block font-medium tabular-nums">{it.booking.ticketNo}</span>
                      <span className="block truncate">{it.booking.company}</span>
                      {it.text}
                      {it.booking.isTentative ? <span className="block">Tentative: waiting for PO</span> : null}
                    </li>
                  ) : null,
                )}
                {!list.length ? <li className="text-xs text-muted-foreground">{off ? "" : "Free"}</li> : null}
              </ul>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
