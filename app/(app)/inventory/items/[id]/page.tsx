import type { Metadata } from "next";
import { ArrowLeft, Boxes, Download, PackageMinus, PackagePlus, Pencil, SlidersHorizontal, Store, Wrench } from "lucide-react";
import { PriceChart, UsageChart } from "@/components/inventory/item-charts";
import { runsOutInDays } from "@/lib/inventory/calc";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { FormSkeleton } from "@/components/common/form-skeleton";
import { StatusChips } from "@/components/inventory/items-list";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { getDailyUse, getInvItem, getItemHistory, getItemPriceHistory, getItemUsageByMonth, type ItemHistoryRow } from "@/lib/inventory-data";
import { formatQty, formatRate } from "@/lib/inventory/numbers";
import { UUID_RE } from "@/lib/inventory/uuid";
import { formatINRShort } from "@/lib/pricing";
import { daysBetween, todayInIndia } from "@/lib/tickets";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Item" };

export default function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2">
        <Link href="/inventory/items">
          <ArrowLeft aria-hidden /> All items
        </Link>
      </Button>
      <Suspense fallback={<FormSkeleton />}>
        <Detail params={params} />
      </Suspense>
    </div>
  );
}

async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const [d, use, history, usage, prices] = await Promise.all([getInvItem(id), getDailyUse(), getItemHistory(id), getItemUsageByMonth(id), getItemPriceHistory(id)]);
  if (!d) notFound();
  const daily = use.perItem.get(id) ?? 0;
  const runsOut = runsOutInDays(d.item.qtyOnHand, daily);
  const i = d.item;
  const today = todayInIndia();
  const expiring = d.batches.some((b) => Number(b.qty) > 0 && b.expiryDate && daysBetween(today, b.expiryDate) <= d.expiryWarningDays);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 className="font-title text-3xl text-primary md:text-4xl">{i.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-muted-foreground">
            <span className="tabular-nums">{i.code}</span> · {i.categoryName}
            {d.depts.map((x) => (
              <span key={x} className="rounded-full border bg-secondary px-2 py-0.5 text-xs font-medium text-primary">
                {x}
              </span>
            ))}
            {!i.isActive ? <span className="rounded-full border px-2 py-0.5 text-xs">Inactive</span> : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href={`/inventory/items/${i.id}/edit`}>
              <Pencil aria-hidden /> Edit
            </Link>
          </Button>
        </div>
      </header>

      {/* Big buttons at the top: a scanned label lands here, ready to use stock. */}
      <div className="flex flex-wrap gap-2">
        <Button asChild size="lg">
          <Link href={`/inventory/movements/new?type=out&item=${i.id}`}>
            <PackageMinus aria-hidden /> Use stock
          </Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href={`/inventory/movements/new?type=in&item=${i.id}`}>
            <PackagePlus aria-hidden /> Stock received
          </Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href={`/inventory/movements/new?type=adj&item=${i.id}`}>
            <SlidersHorizontal aria-hidden /> Adjust stock
          </Link>
        </Button>
      </div>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Stock">
        <Stat
          label="Current stock"
          value={formatQty(i.qtyOnHand, i.unit)}
          extra={
            <div className="flex flex-col gap-1">
              <StatusChips status={i.status} expiring={expiring} />
              <span className="text-sm text-muted-foreground">
                {runsOut === 0 ? "Out of stock" : runsOut == null ? "No recent use" : `Runs out in ~${Math.round(runsOut).toLocaleString("en-IN")} days`}
              </span>
            </div>
          }
        />
        <Stat label="Stock value" value={formatINRShort(i.valuePaise)} />
        <Stat label="Average cost" value={`${formatRate(i.avgCost)} per ${i.unit}`} />
        <Stat label="Reorder" value={`At ${formatQty(i.reorderLevel, i.unit)}`} extra={<span className="text-sm text-muted-foreground">Order {formatQty(i.reorderQty, i.unit)}</span>} />
      </section>

      <section className="rounded-2xl border bg-card p-5">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <Boxes className="size-5 text-primary" aria-hidden /> Details
        </h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="text-muted-foreground">Unit</dt>
          <dd>{i.unit}</dd>
          {i.packName && i.packSize ? (
            <>
              <dt className="text-muted-foreground">Pack</dt>
              <dd>
                {i.packName} of {formatQty(i.packSize, i.unit)}
              </dd>
            </>
          ) : null}
          <dt className="text-muted-foreground">Preferred supplier</dt>
          <dd>{i.preferredSupplierName ?? "Not set"}</dd>
          <dt className="text-muted-foreground">Supplier lead time</dt>
          <dd>{i.leadTimeDays != null ? `${i.leadTimeDays} days` : "Not set"}</dd>
          <dt className="text-muted-foreground">Where it&apos;s kept</dt>
          <dd>{i.storagePlace ?? "Not set"}</dd>
          <dt className="text-muted-foreground">Batches and expiry</dt>
          <dd>{i.trackBatches ? "Tracked" : "Not tracked"}</dd>
          {i.hsnCode ? (
            <>
              <dt className="text-muted-foreground">HSN code</dt>
              <dd>{i.hsnCode}</dd>
            </>
          ) : null}
          {i.notes ? (
            <>
              <dt className="text-muted-foreground">Notes</dt>
              <dd className="whitespace-pre-wrap">{i.notes}</dd>
            </>
          ) : null}
        </dl>
      </section>

      {i.trackBatches ? (
        <section className="rounded-2xl border bg-card p-5">
          <h2 className="mb-3 text-lg font-semibold">Batches</h2>
          {d.batches.filter((b) => Number(b.qty) > 0).length ? (
            <ul className="divide-y">
              {d.batches
                .filter((b) => Number(b.qty) > 0)
                .map((b) => {
                  const left = b.expiryDate ? daysBetween(today, b.expiryDate) : null;
                  return (
                    <li key={b.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
                      <span className="min-w-0 flex-1 font-medium tabular-nums">Batch {b.batchNo}</span>
                      <span className="tabular-nums">{formatQty(b.qty, i.unit)}</span>
                      <span className="text-sm text-muted-foreground">{b.expiryDate ? `Expires ${formatDate(b.expiryDate)}` : "No expiry"}</span>
                      {left != null ? (
                        <span
                          className={cn(
                            "rounded-full border px-2 py-0.5 text-xs font-medium",
                            left < 0 ? "border-red-200 bg-red-50 text-red-700" : left <= d.expiryWarningDays ? "border-violet-200 bg-violet-50 text-violet-800" : "bg-secondary text-muted-foreground",
                          )}
                        >
                          {left < 0 ? "Expired" : left === 0 ? "Expires today" : `Expires in ${left} ${left === 1 ? "day" : "days"}`}
                        </span>
                      ) : null}
                    </li>
                  );
                })}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No batches in stock.</p>
          )}
        </section>
      ) : null}

      <section className="rounded-2xl border bg-card p-5">
        <h2 className="text-lg font-semibold">Use per month</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Quantity used for jobs and internal use, last 12 months.{daily > 0 ? ` Recent average: ${formatQty(daily.toFixed(3), i.unit)} a day (last ${use.days} days).` : ""}
        </p>
        <UsageChart data={usage} unit={i.unit} />
      </section>

      <section className="rounded-2xl border bg-card p-5">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <Store className="size-5 text-primary" aria-hidden /> Suppliers and prices
        </h2>
        {d.prices.length ? (
          <ul className="divide-y">
            {d.prices.map((p) => (
              <li key={p.supplierId} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
                <Link href={`/inventory/suppliers/${p.supplierId}`} className="min-w-0 flex-1 font-medium text-primary hover:underline">
                  {p.name}
                </Link>
                <span className="tabular-nums">{p.lastRate ? `${formatRate(p.lastRate)} per ${i.unit}` : "No rate yet"}</span>
                <span className="text-sm text-muted-foreground">{p.lastRateDate ? `on ${formatDate(p.lastRateDate)}` : ""}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No stock received yet. Each supplier&apos;s last rate appears here after stock is received.</p>
        )}
        {prices.length >= 2 ? (
          <div className="mt-4">
            <p className="mb-2 text-sm text-muted-foreground">Purchase rate per {i.unit} (before GST), each delivery</p>
            <PriceChart data={prices} unit={i.unit} />
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border bg-card p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Stock history</h2>
          {history.length ? (
            <Button asChild variant="outline" size="sm">
              <a href={`/api/inventory/items/${i.id}/history`} download>
                <Download aria-hidden /> Download as Excel
              </a>
            </Button>
          ) : null}
        </div>
        {history.length ? <HistoryTable rows={history} unit={i.unit} /> : <p className="text-sm text-muted-foreground">No stock in or out yet.</p>}
      </section>

      <section className="rounded-2xl border bg-card p-5">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <Wrench className="size-5 text-primary" aria-hidden /> Used by services
        </h2>
        {d.usedBy.length ? (
          <ul className="divide-y">
            {d.usedBy.map((u) => (
              <li key={u.serviceId} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
                <span className="rounded-full border bg-secondary px-2 py-0.5 text-xs font-medium text-primary">{u.deptCode}</span>
                <span className="min-w-0 flex-1 font-medium">{u.name}</span>
                <span className="text-sm tabular-nums">
                  {formatQty(u.qtyPerUnit, i.unit)} {u.unitLabel}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No rate-card service lists this item yet. Add it under “Materials used” on the Rate Card.</p>
        )}
      </section>
    </div>
  );
}

function HistoryTable({ rows, unit }: { rows: ItemHistoryRow[]; unit: string }) {
  const what = (r: ItemHistoryRow) =>
    r.isReversal
      ? (r.note ?? "Reversal")
      : r.type === "IN"
        ? [r.supplier, r.billNo ? `bill ${r.billNo}` : null].filter(Boolean).join(", ")
        : r.type === "OUT"
          ? r.ticketNo
            ? `Job ${r.ticketNo}`
            : (r.purpose ?? "")
          : [r.reason, r.note].filter(Boolean).join(": ");
  return (
    <div className="-mx-5 overflow-x-auto px-5">
      <table className="w-full min-w-[640px] text-sm">
        <caption className="sr-only">Stock history, newest first</caption>
        <thead className="border-b text-left text-muted-foreground">
          <tr>
            <th scope="col" className="py-2 pr-3 font-medium">Date</th>
            <th scope="col" className="py-2 pr-3 font-medium">Record</th>
            <th scope="col" className="py-2 pr-3 font-medium">For / from</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">In / out</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">Balance</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">Value</th>
            <th scope="col" className="py-2 font-medium">By</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const inn = Number(r.qtyIn) > 0;
            return (
              <tr key={r.id} className={cn("border-b last:border-0", r.isReversed && "text-muted-foreground line-through decoration-1")}>
                <td className="py-2 pr-3 whitespace-nowrap">{formatDate(r.docDate)}</td>
                <td className="py-2 pr-3 whitespace-nowrap">
                  <Link href={`/inventory/movements/${r.docId}`} className="text-primary tabular-nums hover:underline">
                    {r.docNo}
                  </Link>
                </td>
                <td className="py-2 pr-3">
                  {what(r)}
                  {r.batchNo ? <span className="block text-xs text-muted-foreground">Batch {r.batchNo}</span> : null}
                </td>
                <td className={cn("py-2 pr-3 text-right whitespace-nowrap tabular-nums", inn ? "text-emerald-700" : "text-red-700")}>
                  {inn ? "+" : "−"}
                  {formatQty(inn ? r.qtyIn : r.qtyOut, unit)}
                </td>
                <td className="py-2 pr-3 text-right font-medium whitespace-nowrap tabular-nums">{formatQty(r.balanceAfter, unit)}</td>
                <td className="py-2 pr-3 text-right whitespace-nowrap tabular-nums">{formatINRShort(r.valuePaise)}</td>
                <td className="py-2 whitespace-nowrap">{r.doneBy ?? ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Stat({ label, value, extra }: { label: string; value: string; extra?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold text-primary tabular-nums">{value}</p>
      {extra ? <div className="mt-1.5">{extra}</div> : null}
    </div>
  );
}
