import type { Metadata } from "next";
import { ArrowLeft, Boxes, Pencil, Store, Wrench } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { FormSkeleton } from "@/components/common/form-skeleton";
import { StatusChips } from "@/components/inventory/items-list";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { getInvItem } from "@/lib/inventory-data";
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
  const d = await getInvItem(id);
  if (!d) notFound();
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

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Stock">
        <Stat label="Current stock" value={formatQty(i.qtyOnHand, i.unit)} extra={<StatusChips status={i.status} expiring={expiring} />} />
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

function Stat({ label, value, extra }: { label: string; value: string; extra?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold text-primary tabular-nums">{value}</p>
      {extra ? <div className="mt-1.5">{extra}</div> : null}
    </div>
  );
}
