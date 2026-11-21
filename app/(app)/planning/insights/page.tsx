import type { Metadata } from "next";
import { AlertTriangle, Download, Info } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { PageHeader } from "@/components/common/page-header";
import { InsightsFilters } from "@/components/inventory/insights-filters";
import { BlockedChart, LabelBars, OnTimeChart, UseBars } from "@/components/planning/insights-charts";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/format";
import type { PlanningSection } from "@/lib/planning/insights-tables";
import { BLOCK_TYPE_NAMES, BUSY_PCT, getPlanningInsights, planningInsightFiltersFromParams, QUIET_PCT, type PlanningInsights } from "@/lib/planning-insights";
import { formatINRShort } from "@/lib/pricing";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Planning insights" };

type Sp = Promise<Record<string, string | string[] | undefined>>;

export default function Page({ searchParams }: { searchParams: Sp }) {
  return (
    <div>
      <PageHeader title="Planning insights" description="How busy each machine is, how much work is waiting, quoted vs actual hours, and on-time delivery." />
      <Suspense fallback={<Skeleton className="h-[40rem] rounded-2xl" />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const pct = (v: number | null | undefined) => (v == null ? "-" : `${Math.round(v)}%`);
const hrs = (h: number) => `${(Math.round(h * 10) / 10).toLocaleString("en-IN")} h`;
const days = (d: number) => `about ${d.toLocaleString("en-IN")} working ${d === 1 ? "day" : "days"}`;
const perHour = (paise: number) => `${formatINRShort(Math.round(paise / 100) * 100)}/h`;
const list = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);
const jobHref = (id: string) => `/planning/jobs?job=${id}`;

async function Body({ searchParams }: { searchParams: Sp }) {
  const f = await planningInsightFiltersFromParams(await searchParams);
  const d = await getPlanningInsights(f);
  const q = new URLSearchParams({
    from: f.from,
    to: f.to,
    ...(f.dept ? { dept: f.dept } : {}),
  });
  const excel = (s: PlanningSection) => `/api/planning/insights?section=${s}&${q}`;
  return (
    <>
      <InsightsFilters from={f.from} to={f.to} dept={f.dept} departments={d.departments} periods="planning" />
      <div className="flex flex-col gap-6">
        <Section
          title="Machine use"
          why="For each machine, the booked hours and the hours it actually ran, out of the hours it was available (working hours, or 24 hours a day for day-and-night machines, minus blocked time). Busiest first."
          excel={excel("use")}
        >
          <UseLines d={d} />
          <UseBars rows={d.use} />
        </Section>

        <Section
          title="Work waiting"
          why="For each department, the hours of jobs still to book plus booked hours still to come, as working days of what its machines can do in a day. Shows today's position, whatever the dates above."
          excel={excel("waiting")}
        >
          {d.waiting.some((w) => w.hours > 0 || w.noTimeJobs) ? (
            <>
              <LabelBars
                label="Working days of work waiting, per department"
                rows={d.waiting.map((w) => ({
                  key: w.deptCode,
                  name: `${w.deptCode}: ${w.name}`,
                  value: w.days ?? 0,
                  text: w.days == null ? (w.hours > 0 ? `${hrs(w.hours)}, no machines to do it` : "Nothing waiting") : w.hours > 0 ? days(w.days) : "Nothing waiting",
                  sub:
                    w.hours > 0
                      ? `${hrs(w.toBookHours)} to book + ${hrs(w.bookedHours)} booked${w.noTimeJobs ? ` · ${w.noTimeJobs} ${w.noTimeJobs === 1 ? "job" : "jobs"} with no time set` : ""}`
                      : undefined,
                  href: `/planning/jobs?dept=${w.deptCode}`,
                }))}
              />
              {d.waiting.some((w) => w.noTimeJobs) ? (
                <p className="mt-3 flex items-start gap-1.5 text-sm text-muted-foreground">
                  <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>
                    Jobs with no time set and no booking are not counted.{" "}
                    <Link href="/planning/jobs?status=TO_PLAN" className="underline">
                      Set their time in Jobs
                    </Link>
                  </span>
                </p>
              ) : null}
            </>
          ) : (
            <Empty>No work waiting.</Empty>
          )}
        </Section>

        <Section
          title="Quoted vs actual hours"
          why={`Per-hour services done in this period that took more than ${d.alertPct}% longer than quoted, with the value of the extra hours at the customer's rate. Change the % in Settings.`}
          excel={excel("quoted")}
        >
          <QuotedSection d={d} />
        </Section>

        <Section title="On-time delivery" why="Jobs done in this period by their promised date, by department and month. Jobs without a promised date are left out." excel={excel("on-time")}>
          <OnTimeSection d={d} />
        </Section>

        <Section
          title="Machine not available"
          why="Working hours each machine was blocked, by reason, per month. Long or repeated breakdowns are a sign to look at the maintenance plan."
          excel={excel("not-available")}
        >
          {d.blocked.rows.length ? (
            <>
              <BlockedChart
                rows={d.blocked.byMonth}
                types={d.blocked.types.map((t) => ({
                  key: t,
                  name: BLOCK_TYPE_NAMES[t],
                }))}
              />
              <div className="mt-4">
                <Table
                  head={["Machine", "Month", ...d.blocked.types.map((t) => BLOCK_TYPE_NAMES[t]), "Total"]}
                  align={["left", "left", ...d.blocked.types.map(() => "right" as const), "right"]}
                  rows={d.blocked.rows.map((r) => [
                    <Link key="n" href={`/planning/machines/${r.machineId}`} className="font-medium hover:text-primary hover:underline">
                      {r.name}
                    </Link>,
                    monthLabel(r.month),
                    ...d.blocked.types.map((t) => (r.hours[t] > 0 ? hrs(r.hours[t]) : "-")),
                    <span key="t" className="font-semibold">
                      {hrs(r.total)}
                    </span>,
                  ])}
                />
              </div>
            </>
          ) : (
            <Empty>No machine was blocked in this period.</Empty>
          )}
        </Section>

        <Section
          title="Earnings per machine hour"
          why="For each machine: the ticket value before GST of jobs done in this period, divided by the hours they actually ran on it. A job that ran on two machines is split by hours. Machines that ran less than 1 hour are left out."
          excel={excel("earnings")}
        >
          {d.earnings.length ? (
            <LabelBars
              label="Earnings per machine hour"
              rows={d.earnings.map((e) => ({
                key: e.machineId,
                name: e.name,
                value: e.perHourPaise,
                text: perHour(e.perHourPaise),
                sub: `${formatINRShort(e.valuePaise)} over ${hrs(e.hours)} · ${e.jobs} ${e.jobs === 1 ? "job" : "jobs"}`,
                href: `/planning/machines/${e.machineId}`,
              }))}
            />
          ) : (
            <Empty>No jobs with recorded running time were done in this period.</Empty>
          )}
        </Section>
      </div>
    </>
  );
}

function UseLines({ d }: { d: PlanningInsights }) {
  return (
    <div className="mb-4 flex flex-col gap-2">
      {d.busy.length ? (
        d.busy.slice(0, 3).map((b) => (
          <p key={b.name} className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-950">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {b.name} is {pct(b.pct)} booked for the next 2 weeks. {b.nonstop ? "Quote later start dates for new jobs, or consider more capacity." : "Consider an extra shift."}
          </p>
        ))
      ) : (
        <p className="text-sm text-muted-foreground">No machine is more than {BUSY_PCT}% booked for the next 2 weeks.</p>
      )}
      {d.quiet.length || d.unused ? (
        <p className="flex items-start gap-2 rounded-xl border bg-secondary/50 px-3 py-2 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span>
            {d.quiet.length ? (
              <>
                Rarely used in this period (ran less than {QUIET_PCT}% of the available time): {list(d.quiet.slice(0, 4).map((m) => `${m.name} (${pct(m.pct)})`))}
                {d.quiet.length > 4 ? ` and ${d.quiet.length - 4} more` : ""}.{" "}
              </>
            ) : null}
            {d.unused ? `${d.unused} ${d.unused === 1 ? "machine was" : "machines were"} not used at all.` : null}
          </span>
        </p>
      ) : null}
    </div>
  );
}

function QuotedSection({ d }: { d: PlanningInsights }) {
  const { flagged, jobs, extraHours, aboutPaise } = d.quoted;
  if (!jobs) return <Empty>No per-hour jobs with recorded running time were done in this period.</Empty>;
  if (!flagged.length)
    return (
      <Empty>
        All {jobs} per-hour jobs done in this period stayed within {d.alertPct}% of the quoted hours.
      </Empty>
    );
  return (
    <>
      <p className="mb-4 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-950">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          {flagged.length === 1 ? "This job" : `These ${flagged.length} jobs`} took {Math.round(extraHours).toLocaleString("en-IN")} more hours than quoted, worth about {formatINRShort(aboutPaise)}{" "}
          not billed. ({flagged.length} of {jobs} per-hour jobs done.)
        </span>
      </p>
      <Table
        head={["Ticket", "Customer", "Quoted", "Actual", "Over by", "Extra value"]}
        align={["left", "left", "right", "right", "right", "right"]}
        rows={flagged.map((j) => [
          <span key="t">
            <Link href={jobHref(j.jobId)} className="font-medium hover:text-primary hover:underline">
              {j.ticketNo}
            </Link>
            <span className="block max-w-64 truncate text-xs text-muted-foreground">{j.service}</span>
          </span>,
          <span key="c" className="block max-w-48 truncate">
            {j.company}
          </span>,
          hrs(j.quotedHours),
          hrs(j.actualHours),
          <span key="o" className="font-semibold text-destructive">
            +{hrs(j.extraHours)} ({pct(j.overPct)})
          </span>,
          formatINRShort(j.extraPaise),
        ])}
      />
    </>
  );
}

function OnTimeSection({ d }: { d: PlanningInsights }) {
  const o = d.onTime;
  return (
    <>
      {o.overall.done ? (
        <>
          <p className="mb-3 text-sm">
            <span className="text-2xl font-semibold tabular-nums">{pct(o.overall.pct)}</span>{" "}
            <span className="text-muted-foreground">
              on time ({o.overall.onTime} of {o.overall.done} jobs done)
            </span>
          </p>
          <OnTimeChart rows={o.months} />
          <div className="mt-4">
            <Table
              head={["Department", ...o.months.map((m) => monthLabel(m.month)), "All"]}
              align={["left", ...o.months.map(() => "right" as const), "right"]}
              rows={o.depts.map((r) => [
                <span key="d" className="font-medium">
                  {r.dept}: {d.deptName[r.dept] ?? r.dept}
                </span>,
                ...r.cells.map((c) => (c.done ? <PctCell key={c.month} pct={c.pct} done={c.done} /> : "-")),
                <PctCell key="all" pct={r.overall.pct} done={r.overall.done} strong />,
              ])}
            />
          </div>
        </>
      ) : (
        <Empty>No jobs with a promised date were done in this period.</Empty>
      )}
      <h3 className="mt-6 mb-2 text-sm font-semibold">Late jobs</h3>
      {o.late.length ? (
        <Table
          head={["Ticket", "Customer", "Promised", "Done", "Late by"]}
          align={["left", "left", "right", "right", "right"]}
          rows={o.late.map((j) => [
            <span key="t">
              <Link href={jobHref(j.jobId)} className="font-medium hover:text-primary hover:underline">
                {j.ticketNo}
              </Link>
              <span className="block max-w-64 truncate text-xs text-muted-foreground">{j.service}</span>
            </span>,
            <span key="c" className="block max-w-48 truncate">
              {j.company}
            </span>,
            formatDate(j.promised),
            j.done ? (
              formatDate(j.done)
            ) : (
              <span key="n" className="font-medium text-amber-800">
                Not done yet
              </span>
            ),
            `${j.daysLate} ${j.daysLate === 1 ? "day" : "days"}`,
          ])}
        />
      ) : (
        <Empty>No late jobs in this period.</Empty>
      )}
    </>
  );
}

function PctCell({ pct: v, done, strong }: { pct: number | null; done: number; strong?: boolean }) {
  return (
    <span className={cn(strong && "font-semibold", v != null && v < 80 && "text-destructive")} title={`${done} ${done === 1 ? "job" : "jobs"} done`}>
      {pct(v)}
    </span>
  );
}

function Section({ title, why, excel, children }: { title: string; why: string; excel: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-2xl border bg-card p-4 sm:p-5">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground">{why}</p>
        </div>
        <Button asChild variant="outline" size="sm" className="shrink-0 self-start">
          <a href={excel} download>
            <Download aria-hidden /> Download as Excel
          </a>
        </Button>
      </div>
      {children}
    </section>
  );
}

function Table({ head, rows, align }: { head: string[]; rows: React.ReactNode[][]; align: ("left" | "right")[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-sm">
        <thead className="border-b text-muted-foreground">
          <tr>
            {head.map((h, i) => (
              <th key={`${h}-${i}`} className={cn("px-2 py-2 font-medium", align[i] === "right" ? "text-right" : "text-left")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r, n) => (
            <tr key={n}>
              {r.map((c, i) => (
                <td key={i} className={cn("px-2 py-2", align[i] === "right" ? "text-right tabular-nums" : "text-left")}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => <p className="text-sm text-muted-foreground">{children}</p>;
