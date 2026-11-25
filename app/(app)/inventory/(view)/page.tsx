import { Can } from "@/components/auth/permissions-provider";
import type { Metadata } from "next";
import { AlertTriangle, ArrowRight, CalendarClock, IndianRupee, PackageX, Plus, ShoppingCart, Upload } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { PageHeader } from "@/components/common/page-header";
import { DocTypeChip } from "@/components/inventory/doc-type";
import { runsOutText } from "@/lib/inventory/stock";
import { OrderedChip } from "@/components/inventory/ordered-chip";
import { QuickActions } from "@/components/inventory/quick-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/format";
import { getInvOverview, type InvOverview } from "@/lib/inventory-data";
import { formatQty } from "@/lib/inventory/numbers";
import { formatINRShort } from "@/lib/pricing";
import { cn } from "@/lib/utils";

/** Reads who is signed in (and stops with forbidden() when they may not see it), so it blocks on the server: no instant-navigation validation. */
export const instant = false;

export const metadata: Metadata = { title: "Inventory" };

export default function InventoryOverview() {
  return (
    <div>
      <PageHeader
        title="Inventory"
        description="Materials and consumables: what's in stock, what each job uses, and what to reorder."
        actions={
          <div className="flex flex-wrap gap-2">
            <Can perm="inventory.items">
              <Button asChild variant="outline">
                <Link href="/inventory/items/import">
                  <Upload aria-hidden /> Import items
                </Link>
              </Button>
            </Can>
            <Can perm="inventory.items">
              <Button asChild variant="outline">
                <Link href="/inventory/items/new">
                  <Plus aria-hidden /> Add item
                </Link>
              </Button>
            </Can>
          </div>
        }
      />
      <QuickActions big className="mb-6" />
      <Suspense fallback={<Skeleton className="h-96 rounded-2xl" />}>
        <Overview />
      </Suspense>
    </div>
  );
}

async function Overview() {
  const o = await getInvOverview();
  const cards = [
    { label: "Stock value", value: formatINRShort(o.cards.valuePaise), href: "/inventory/items", icon: IndianRupee, tone: "" },
    { label: "Items to reorder", value: o.cards.toReorder.toLocaleString("en-IN"), href: "/inventory/reorder", icon: ShoppingCart, tone: o.cards.toReorder ? "text-amber-700" : "" },
    { label: "Out of stock", value: o.cards.outOfStock.toLocaleString("en-IN"), href: "/inventory/items?status=out", icon: PackageX, tone: o.cards.outOfStock ? "text-destructive" : "" },
    {
      label: `Expired or expiring (${o.warnDays} days)`,
      value: o.cards.expiring.toLocaleString("en-IN"),
      href: "/inventory/items?status=expiring",
      icon: CalendarClock,
      tone: o.cards.expiring ? "text-purple-700" : "",
    },
  ];
  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map(({ label, value, href, icon: Icon, tone }) => (
          <Link key={label} href={href} className="rounded-2xl">
            <Card className="h-full transition hover:border-primary/30">
              <CardContent className="flex flex-col gap-3">
                <Icon className={cn("size-6", tone || "text-primary/70")} aria-hidden />
                <div>
                  <div className={cn("text-2xl font-semibold tabular-nums md:text-3xl", tone || "text-primary")}>{value}</div>
                  <div className="text-sm text-muted-foreground">{label}</div>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
      <NeedsAttention o={o} />
      <Recent o={o} />
    </div>
  );
}

function Block({ title, count, href, linkLabel, children }: { title: string; count: number; href?: string; linkLabel?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border bg-card">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <h3 className="font-semibold">
          {title} <span className="ml-1 rounded-full bg-secondary px-2 py-0.5 text-xs tabular-nums">{count}</span>
        </h3>
        {href && count ? (
          <Button asChild variant="ghost" size="sm">
            <Link href={href}>
              {linkLabel ?? "See all"} <ArrowRight aria-hidden />
            </Link>
          </Button>
        ) : null}
      </div>
      <ul className="divide-y text-sm">{children}</ul>
    </div>
  );
}

const Row = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <li>
    <Link href={href} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2.5 hover:bg-secondary/60">
      {children}
    </Link>
  </li>
);

function NeedsAttention({ o }: { o: InvOverview }) {
  const empty = !o.toReorder.length && !o.late.length && !o.expiringSoon.length && !o.expired.length && !o.jobsWithoutMaterials.length;
  return (
    <section aria-labelledby="attention-heading">
      <h2 id="attention-heading" className="mb-4 flex items-center gap-2 text-xl font-semibold">
        <AlertTriangle className="size-5 text-amber-600" aria-hidden /> Needs attention
      </h2>
      {empty ? (
        <p className="rounded-2xl border bg-card p-6 text-center text-muted-foreground">Nothing needs attention right now.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {o.late.length ? (
            <Block title="Deliveries late" count={o.late.length}>
              {o.late.slice(0, 6).map((l) => (
                <Row key={l.id} href={`/inventory/items/${l.id}`}>
                  <span className="font-medium">{l.name}</span>
                  <OrderedChip on={l.orderedOn} supplierName={l.supplier} late />
                </Row>
              ))}
            </Block>
          ) : null}
          {o.toReorder.length ? (
            <Block title="Items to reorder" count={o.toReorder.length} href="/inventory/reorder" linkLabel="Reorder list">
              {o.toReorder.slice(0, 6).map((i) => (
                <Row key={i.id} href={`/inventory/items/${i.id}`}>
                  <span className="font-medium">{i.name}</span>
                  <span className="text-muted-foreground">
                    {Number(i.qty) > 0 ? `${formatQty(i.qty, i.unit)} · runs out in ${runsOutText(i.runsOutDays, i.qty)}` : "Out of stock"}
                    {i.orderedOn ? " · ordered" : ""}
                  </span>
                </Row>
              ))}
            </Block>
          ) : null}
          {o.expired.length ? (
            <Block title="Expired, still in stock" count={o.expired.length}>
              {o.expired.slice(0, 6).map((b) => (
                <Row key={b.id} href={`/inventory/items/${b.itemId}`}>
                  <span className="font-medium">
                    {b.name} <span className="font-normal text-muted-foreground">batch {b.batchNo}</span>
                  </span>
                  <span className="text-destructive">
                    {formatQty(b.qty, b.unit)} · {formatINRShort(b.valuePaise)} · expired {formatDate(b.expiryDate)}
                  </span>
                </Row>
              ))}
            </Block>
          ) : null}
          {o.expiringSoon.length ? (
            <Block title={`Expiring in ${o.warnDays} days`} count={o.expiringSoon.length} href="/inventory/items?status=expiring">
              {o.expiringSoon.slice(0, 6).map((b) => (
                <Row key={b.id} href={`/inventory/items/${b.itemId}`}>
                  <span className="font-medium">
                    {b.name} <span className="font-normal text-muted-foreground">batch {b.batchNo}</span>
                  </span>
                  <span className="text-purple-800">
                    {formatQty(b.qty, b.unit)} · {b.days === 0 ? "expires today" : `in ${b.days} ${b.days === 1 ? "day" : "days"}`}
                  </span>
                </Row>
              ))}
            </Block>
          ) : null}
          {o.jobsWithoutMaterials.length ? (
            <Block title="Jobs billed with no materials recorded" count={o.jobsWithoutMaterials.length} href="/orders?materials=missing" linkLabel="Open board">
              {o.jobsWithoutMaterials.slice(0, 6).map((t) => (
                <Row key={t.id} href={`/orders?ticket=${t.id}`}>
                  <span className="min-w-0">
                    <span className="font-medium tabular-nums">{t.ticket_no}</span> <span className="text-muted-foreground">{t.company}</span>
                  </span>
                  <span className="truncate text-muted-foreground">{t.description}</span>
                </Row>
              ))}
            </Block>
          ) : null}
        </div>
      )}
    </section>
  );
}

function Recent({ o }: { o: InvOverview }) {
  return (
    <section aria-labelledby="recent-heading">
      <div className="mb-4 flex items-center justify-between">
        <h2 id="recent-heading" className="text-xl font-semibold">
          Recent stock in &amp; out
        </h2>
        <Button asChild variant="ghost" size="sm">
          <Link href="/inventory/movements">
            See all <ArrowRight aria-hidden />
          </Link>
        </Button>
      </div>
      {!o.recent.length ? (
        <p className="rounded-2xl border bg-card p-6 text-center text-muted-foreground">No stock records yet.</p>
      ) : (
        <ul className="divide-y rounded-2xl border bg-card">
          {o.recent.map((d) => (
            <li key={d.id}>
              <Link href={`/inventory/movements/${d.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-secondary/60">
                <span className="w-24 shrink-0 text-sm text-muted-foreground">{formatDate(d.docDate)}</span>
                <span className="font-semibold text-primary tabular-nums">{d.docNo}</span>
                <DocTypeChip type={d.type} reversal={!!d.reverses} />
                <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{d.items}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
