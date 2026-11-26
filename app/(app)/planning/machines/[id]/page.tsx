import { Can } from "@/components/auth/permissions-provider";
import { may } from "@/lib/auth/guard";
import type { Metadata } from "next";
import { ArrowLeft, ChevronLeft, ChevronRight, Pencil } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { FormSkeleton } from "@/components/common/form-skeleton";
import { BlockTimeButton, BreakdownButton, DeleteBlockButton, FixedButton } from "@/components/planning/block-time";
import { LiveStatusChip, MachineChips, pctText } from "@/components/planning/machine-bits";
import { StillBrokenDown } from "@/components/planning/still-broken";
import { ClashActions } from "@/components/planning/clash-actions";
import { Button } from "@/components/ui/button";
import { UUID_RE } from "@/lib/inventory/uuid";
import { getMachine, getRecentInternalUse, getTimeline, listHolidays, type MachineDetail, type TimelineData } from "@/lib/planning-data";
import { MachineWeek } from "@/components/planning/machine-week";
import { dayPlus, formatHours, formatWhen, istAt, istDate } from "@/lib/planning/hours";
import { BLOCK_TYPES } from "@/lib/validation/planning";

/** Reads who is signed in (and stops with forbidden() when they may not see it), so it blocks on the server: no instant-navigation validation. */
export const instant = false;

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
  // Internal-use records are only for people who can block machine time (the others can still see the machine).
  const [d, stockRecords] = await Promise.all([getMachine(id, typeof sp.week === "string" ? sp.week : undefined), (await may("planning.blocks")) ? getRecentInternalUse() : []]);
  // The week, drawn like the Department board: only this machine's bookings and blocked time are read (on the server).
  const [t, holidays] = d ? await Promise.all([getTimeline({ view: "week", date: d.week.from, machine: id }), listHolidays()]) : [null, []];
  if (!d) notFound();
  const m = d.machine;
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-title text-3xl text-primary md:text-4xl">{m.name}</h1>
            <LiveStatusChip live={d.live} />
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
          <Can perm="planning.machines">
            <Button asChild variant="outline">
              <Link href={`/planning/machines/${m.id}/edit`}>
                <Pencil aria-hidden /> Edit
              </Link>
            </Button>
          </Can>
          <Can perm="planning.blocks" dept={m.deptCode}>
            <BlockTimeButton machineId={m.id} stockRecords={stockRecords} />
          </Can>
          <Can perm="planning.blocks" dept={m.deptCode}>
            {m.status === "BREAKDOWN" ? <FixedButton machineId={m.id} /> : m.isActive ? <BreakdownButton machineId={m.id} machineName={m.name} /> : null}
          </Can>
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

      <Week d={d} t={t} holidays={holidays} />

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
function Week({ d, t, holidays }: { d: MachineDetail; t: TimelineData | null; holidays: { date: string; name: string }[] }) {
  const days = Array.from({ length: 7 }, (_, i) => dayPlus(d.week.from, i));
  const now = new Date();
  const range = `${formatWhen(istAt(days[0], 0)).split(",")[0]} to ${formatWhen(istAt(days[6], 0)).split(",")[0]}`;
  const p = d.pattern;
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
      <MachineWeek
        machine={{ id: d.machine.id, runsNonstop: d.machine.runsNonstop }}
        deptCode={d.machine.deptCode}
        weekFrom={d.week.from}
        today={istDate(now)}
        nowIso={now.toISOString()}
        hours={{ days: p.days, shiftStart: p.shiftStart, shiftEnd: p.shiftEnd, breakStart: p.breakStart, breakEnd: p.breakEnd }}
        holidays={holidays.filter((h) => days.includes(h.date)).map((h) => ({ date: h.date, name: h.name }))}
        allHolidays={[...p.holidays]}
        bookings={t?.bookings ?? []}
        blocks={t?.blocks ?? []}
        full24={false}
      />
      {d.week.blocks.length ? (
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-semibold">Not available this week</h3>
          <ul className="flex flex-col gap-1.5">
            {d.week.blocks.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-300 bg-[repeating-linear-gradient(135deg,#f1f5f9_0_6px,#e2e8f0_6px_12px)] p-2 text-xs text-slate-800">
                <span>
                  <span className="font-medium">{BLOCK_TYPES[b.type]}</span> · {formatWhen(b.startAt)} to {formatWhen(b.endAt)}
                  {b.note ? <span className="block text-slate-600">{b.note}</span> : null}
                  {b.invDocumentId ? (
                    <Link href={`/inventory/movements/${b.invDocumentId}`} className="font-medium underline">
                      Spares used
                    </Link>
                  ) : null}
                </span>
                {b.endAt > now ? (
                  <Can perm="planning.blocks" dept={d.machine.deptCode}>
                    <DeleteBlockButton blockId={b.id} label={BLOCK_TYPES[b.type].toLowerCase()} />
                  </Can>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
