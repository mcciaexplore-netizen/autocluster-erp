import type { Metadata } from "next";
import { AlertTriangle, Download } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { PageHeader } from "@/components/common/page-header";
import { MonthBars, SpendChart, ValueBars } from "@/components/inventory/insights-charts";
import { InsightsFilters } from "@/components/inventory/insights-filters";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/format";
import { getInsights, insightFiltersFromParams, type Insights } from "@/lib/inventory-insights";
import { VERDICT, type InsightSection } from "@/lib/inventory/insights-tables";
import { formatQty, formatRate } from "@/lib/inventory/numbers";
import { formatINRShort } from "@/lib/pricing";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Inventory insights" };

type Sp = Promise<Record<string, string | string[] | undefined>>;

export default function InsightsPage({ searchParams }: { searchParams: Sp }) {
  return (
    <div>
      <PageHeader title="Insights" description="Where material money goes, what each service keeps, and what needs a decision." />
      <Suspense fallback={<Skeleton className="h-[40rem] rounded-2xl" />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pctText = (v: number | null | undefined) => (v == null ? "-" : `${Math.round(v)}%`);

async function Body({ searchParams }: { searchParams: Sp }) {
  const f = await insightFiltersFromParams(await searchParams);
  const d = await getInsights(f);
  const q = new URLSearchParams({ from: f.from, to: f.to, ...(f.dept ? { dept: f.dept } : {}) });
  const excel = (s: InsightSection) => `/api/inventory/insights?section=${s}&${q}`;
  return (
    <>
      <InsightsFilters from={f.from} to={f.to} dept={f.dept} departments={d.departments} />
      <div className="flex flex-col gap-6">
        <Section
          title="Material spend by month"
          why={`Value of stock used for jobs and internal use, by department. ${formatINRShort(d.spend.totalPaise)} in this period. Watch for months that jump.`}
          excel={excel("spend")}
        >
          <SpendChart rows={d.spend.rows} series={d.spend.series} />
        </Section>

        <Section
          title="Kept after materials, by service"
          why={`What each service keeps after paying for materials (revenue before GST minus material cost), for work done, lowest first. Red: materials take more than ${d.shareAlertPct}% of the revenue, so the rate may be too low.`}
          excel={excel("services")}
        >
          <ServicesTable d={d} />
        </Section>

        <Section title="Biggest-spend items" why="The 10 items that cost the most in this period. The running % shows how much of all material spend the top items make up, so you know where better rates matter most." excel={excel("items")}>
          {d.topItems.length ? (
            <Table
              head={["Item", "Value used", "Share", "Running %"]}
              align={["left", "right", "right", "right"]}
              rows={d.topItems.map((i) => [
                <Link key="n" href={`/inventory/items/${i.itemId}`} className="font-medium hover:text-primary hover:underline">
                  {i.name}
                </Link>,
                formatINRShort(i.valuePaise),
                pctText(i.sharePct),
                pctText(i.runningPct),
              ])}
            />
          ) : (
            <Empty>No stock was used in this period.</Empty>
          )}
        </Section>

        <Section title="Price changes" why={`Items whose purchase rate rose more than ${d.alertPct}%, and what that does to what the services using them keep after materials, at MSME rate.`} excel={excel("prices")}>
          {d.priceChanges.length ? (
            <ul className="flex flex-col gap-3">
              {d.priceChanges.map((p) => (
                <li key={p.itemId} className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
                  <p className="flex items-start gap-2 font-medium">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <span>
                      {p.name} costs {Math.round(p.risePct)}% more than in {MONTH_NAMES[Number(p.oldDate.slice(5, 7)) - 1]}
                      {p.oldDate.slice(0, 4) !== p.newDate.slice(0, 4) ? ` ${p.oldDate.slice(0, 4)}` : ""}.
                      {p.services
                        .filter((s) => s.keptNowPct != null && s.keptBeforePct != null)
                        .map((s) => ` ${s.name} jobs now keep ${pctText(s.keptNowPct)} after materials at MSME rate, down from ${pctText(s.keptBeforePct)}.`)
                        .join("")}
                      {p.services.length ? " Consider reviewing the rate card." : ""}
                    </span>
                  </p>
                  <p className="mt-1 pl-6 text-amber-900/80">
                    {formatRate(p.oldRate)} on {formatDate(p.oldDate)} → {formatRate(p.newRate)} per {p.unit} on {formatDate(p.newDate)}, from {p.supplier}.{" "}
                    <Link href={`/inventory/items/${p.itemId}`} className="underline">
                      See the item
                    </Link>
                    {p.services.length ? (
                      <>
                        {" · "}
                        <Link href="/rate-card" className="underline">
                          Open the rate card
                        </Link>
                      </>
                    ) : null}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No purchase rate rose more than {d.alertPct}% in this period.</Empty>
          )}
        </Section>

        <Section
          title="Money tied up in stock"
          why={`Stock on the shelves now: ${formatINRShort(d.tiedUp.totalPaise)}. Slow-moving items (not used in the last ${d.useDays} days) and items never used hold money that could be spent elsewhere.`}
          excel={excel("tied-up")}
        >
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-semibold">By category</h3>
              <ValueBars rows={d.tiedUp.byCategory} label="Stock value by category" />
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold">By department</h3>
              <ValueBars rows={d.tiedUp.byDepartment} label="Stock value by department" />
              <p className="mt-2 text-xs text-muted-foreground">An item used by several departments is counted in each.</p>
            </div>
          </div>
          <h3 className="mt-6 mb-2 text-sm font-semibold">Slow-moving and never used</h3>
          {d.tiedUp.slow.length ? (
            <Table
              head={["Item", "Stock", "Value", "Last used"]}
              align={["left", "right", "right", "right"]}
              rows={d.tiedUp.slow.slice(0, 15).map((s) => [
                <Link key="n" href={`/inventory/items/${s.itemId}`} className="font-medium hover:text-primary hover:underline">
                  {s.name}
                </Link>,
                formatQty(s.qty, s.unit),
                formatINRShort(s.valuePaise),
                s.neverUsed ? "Never used" : s.lastUsed ? formatDate(s.lastUsed) : "-",
              ])}
            />
          ) : (
            <Empty>Everything in stock was used in the last {d.useDays} days.</Empty>
          )}
        </Section>

        <Section title="Expiry losses" why={`Value of stock written off as expired: ${formatINRShort(d.expiry.totalPaise)} in this period. Order smaller packs, or use the batch that expires first.`} excel={excel("expiry")}>
          <MonthBars rows={d.expiry.byMonth} label="Value written off as expired per month" />
          {d.expiry.items.length ? (
            <div className="mt-4">
              <Table head={["Item", "Written off", "Value"]} align={["left", "right", "right"]} rows={d.expiry.items.map((i) => [i.name, formatQty(i.qty, i.unit), formatINRShort(i.valuePaise)])} />
            </div>
          ) : (
            <Empty>Nothing was written off as expired in this period.</Empty>
          )}
        </Section>

        <Section title="Running out soon" why="Items by how many days their stock lasts at the recent rate of use, next to how long the supplier takes to deliver. Red ones will run out before a new delivery can arrive." excel={excel("running-out")}>
          {d.runningOut.length ? (
            <Table
              head={["Item", "Stock", "Runs out in", "Lead time", "Status"]}
              align={["left", "right", "right", "right", "left"]}
              rows={d.runningOut.map((r) => [
                <Link key="n" href={`/inventory/items/${r.itemId}`} className="font-medium hover:text-primary hover:underline">
                  {r.name}
                </Link>,
                formatQty(r.qty, r.unit),
                r.runsOutDays === 0 ? "-" : `~${Math.round(r.runsOutDays!)} days`,
                `${r.leadTimeDays} days${r.leadIsDefault ? " (default)" : ""}`,
                <span
                  key="v"
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1",
                    r.verdict === "out" || r.verdict === "late" ? "bg-red-50 text-red-800 ring-red-200" : r.verdict === "order" ? "bg-amber-50 text-amber-900 ring-amber-200" : "bg-emerald-50 text-emerald-800 ring-emerald-200",
                  )}
                >
                  {VERDICT[r.verdict]}
                </span>,
              ])}
            />
          ) : (
            <Empty>No recent use to work this out from yet.</Empty>
          )}
        </Section>
      </div>
    </>
  );
}

function ServicesTable({ d }: { d: Insights }) {
  const { ranked, leftOut } = d.services;
  return (
    <>
      {ranked.length ? (
        <Table
          head={["Service", "Jobs", "Revenue", "Materials", "Kept", "Kept %"]}
          align={["left", "right", "right", "right", "right", "right"]}
          rows={ranked.map((s) => {
            const high = s.materialSharePct != null && s.materialSharePct > d.shareAlertPct;
            return [
              <span key="n">
                <span className="font-medium">{s.name}</span> <span className="text-xs text-muted-foreground">{s.deptCode}</span>
                {s.jobsRecorded < s.jobs && !s.noneNeeded ? (
                  <span className="block text-xs text-amber-800">
                    Materials recorded on {s.jobsRecorded} of {s.jobs} jobs
                  </span>
                ) : null}
              </span>,
              s.jobs.toLocaleString("en-IN"),
              formatINRShort(s.revenuePaise),
              formatINRShort(s.materialPaise),
              formatINRShort(s.keptPaise),
              <span key="p" className={cn("font-semibold", high && "text-destructive")} title={high ? `Materials take ${Math.round(s.materialSharePct!)}% of the revenue` : undefined}>
                {pctText(s.keptPct)}
                {s.noneNeeded && !s.materialPaise ? <span className="block text-xs font-normal text-muted-foreground">(no materials)</span> : null}
                {high ? <AlertTriangle className="ml-1 inline size-3.5 align-[-2px]" aria-label="Materials take a high share" /> : null}
              </span>,
            ];
          })}
        />
      ) : (
        <Empty>No jobs with materials in this period.</Empty>
      )}
      {leftOut.length ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {leftOut.length} {leftOut.length === 1 ? "service was" : "services were"} left out of the ranking because {leftOut.length === 1 ? "it has" : "they have"} no materials list and no materials
          recorded ({leftOut.slice(0, 5).join(", ")}
          {leftOut.length > 5 ? ` and ${leftOut.length - 5} more` : ""}).{" "}
          <Link href="/rate-card" className="underline">
            Set materials on the rate card
          </Link>
          .
        </p>
      ) : null}
    </>
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
              <th key={h} className={cn("px-2 py-2 font-medium", align[i] === "right" ? "text-right" : "text-left")}>
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
