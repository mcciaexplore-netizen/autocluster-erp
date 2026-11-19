import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, FilePlus2, FileText, Info, Pencil, SquareKanban } from "lucide-react";
import { CategoryBadge, DeptChip, MemberBadge } from "@/components/common/badges";
import { EmptyState } from "@/components/common/empty-state";
import { ListSkeleton } from "@/components/common/form-skeleton";
import { DeleteCustomerButton } from "@/components/customers/delete-customer-button";
import { DeptIcon } from "@/components/customers/dept-icons";
import { QuotationList } from "@/components/quotations/quotation-list";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getCustomer, getDepartments, getServices, getSettings, listQuotations } from "@/lib/data";
import { getBoardTickets } from "@/lib/orders-data";
import { customerRate, formatINR, formatINRShort, priceTypeFor } from "@/lib/pricing";
import { invoiceChips, todayInIndia } from "@/lib/tickets";
import { StageChip, ToneChip } from "@/components/orders/stage-chip";
import { toPricingSettings } from "@/lib/settings-shared";

export const metadata: Metadata = { title: "Customer" };

export default function CustomerPage({ params }: PageProps<"/customers/[id]">) {
  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2">
        <Link href="/customers">
          <ArrowLeft aria-hidden /> All customers
        </Link>
      </Button>
      <Suspense fallback={<DetailSkeleton />}>
        <CustomerDetail params={params} />
      </Suspense>
    </>
  );
}

async function CustomerDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [c, departments, services, settings] = await Promise.all([getCustomer(id), getDepartments(), getServices(), getSettings()]);
  if (!c) notFound();

  const pricing = toPricingSettings(settings);
  const priceType = priceTypeFor(c, pricing);
  const deptName = (code: string) => departments.find((d) => d.code === code)?.name ?? code;
  const theirServices = services.filter((s) => c.serviceIds.includes(s.id));

  const rows: [string, React.ReactNode][] = [
    ["Address", [c.addressLine1, c.addressLine2, `${c.city} - ${c.pincode}`, c.state].filter(Boolean).join(", ")],
    ["GST number", c.gstRegistered ? <span className="font-mono">{c.gstin}</span> : "Not registered under GST"],
    ["PAN", <span key="pan" className="font-mono">{c.pan}</span>],
    ["TAN", c.tan ? <span className="font-mono">{c.tan}</span> : "Not given"],
    ...(c.category === "MSME" ? ([["Udyam registration no.", c.udyamNo || "Not given"]] as [string, React.ReactNode][]) : []),
    ["Contact person", [c.pocName, c.pocDesignation].filter(Boolean).join(", ")],
    ["Mobile", <a key="tel" href={`tel:+91${c.pocPhone}`} className="text-primary hover:underline">+91 {c.pocPhone}</a>],
    ["Email", <a key="mail" href={`mailto:${c.pocEmail}`} className="break-all text-primary hover:underline">{c.pocEmail}</a>],
    ["MCCIA membership", c.isMcciaMember ? `Member, ID ${c.mcciaMembershipId}` : "Not a member"],
    ["Credit period", `${c.creditDays} days`],
  ];

  return (
    <>
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 className="font-title text-3xl text-primary md:text-4xl">{c.companyName}</h1>
          <div className="mt-3 flex flex-wrap gap-2">
            <CategoryBadge category={c.category} />
            {c.isMcciaMember ? <MemberBadge /> : null}
            {c.deptCodes.map((d) => (
              <DeptChip key={d} code={d} name={deptName(d)} />
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link href={`/quotations/new?customer=${c.id}`}>
              <FilePlus2 aria-hidden /> Create quotation
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href={`/customers/${c.id}/edit`}>
              <Pencil aria-hidden /> Edit
            </Link>
          </Button>
          <DeleteCustomerButton id={c.id} companyName={c.companyName} redirectTo="/customers" />
        </div>
      </div>

      <Tabs defaultValue="details">
        <TabsList className="mb-4">
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="quotations">Quotations</TabsTrigger>
          <TabsTrigger value="orders">Orders</TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="flex flex-col gap-6">
          <div className="grid gap-6 lg:grid-cols-5">
            <Card className="lg:col-span-3">
              <CardHeader>
                <CardTitle>Company and contact</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-[12rem_1fr]">
                  {rows.map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-sm font-medium text-muted-foreground sm:pt-0.5">{k}</dt>
                      <dd className="-mt-3 sm:mt-0">{v}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Price type</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <p className="text-lg font-semibold text-primary">{priceType.badge}</p>
                <p className="flex gap-2 text-sm text-muted-foreground">
                  <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
                  {c.category === "MSME" ? "MSME companies get the MSME rate." : "OEM, Tier 1 and Tier 2 companies get the OEM / Tier 1-2 rate."}{" "}
                  {priceType.discountPct > 0
                    ? `As an MCCIA member, they get ${priceType.discountPct}% off.`
                    : c.isMcciaMember
                      ? "The member discount is switched off for this category in Settings."
                      : "Not an MCCIA member, so no member discount."}
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Services they use</CardTitle>
            </CardHeader>
            <CardContent>
              {theirServices.length ? (
                <ul className="grid gap-3 md:grid-cols-2">
                  {theirServices.map((s) => {
                    const r = customerRate(s, priceType);
                    return (
                      <li key={s.id} className="flex gap-3 rounded-xl border p-4">
                        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-primary">
                          <DeptIcon code={s.deptCode} className="size-5" />
                        </span>
                        <div className="min-w-0">
                          <div className="font-semibold">{s.name}</div>
                          <div className="text-sm text-muted-foreground">
                            {s.deptCode} - {deptName(s.deptCode)}
                          </div>
                          <div className="mt-1">
                            {r.finalRatePaise !== r.listRatePaise ? (
                              <s className="mr-1.5 text-muted-foreground">{formatINRShort(r.listRatePaise)}</s>
                            ) : null}
                            <strong className="text-success">
                              {formatINRShort(r.finalRatePaise)} {s.unitLabel}
                            </strong>
                            {!s.isActive ? <span className="ml-2 text-sm text-muted-foreground">(not offered right now)</span> : null}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-muted-foreground">
                  No services chosen yet.{" "}
                  <Link href={`/customers/${c.id}/edit`} className="font-medium text-primary underline-offset-4 hover:underline">
                    Add services
                  </Link>
                </p>
              )}
              <p className="mt-4 text-sm text-muted-foreground">Prices shown: {priceType.label}.</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="quotations">
          <Suspense fallback={<ListSkeleton rows={3} />}>
            <CustomerQuotations id={c.id} />
          </Suspense>
        </TabsContent>

        <TabsContent value="orders">
          <Suspense fallback={<ListSkeleton rows={3} />}>
            <CustomerOrders id={c.id} />
          </Suspense>
        </TabsContent>
      </Tabs>
    </>
  );
}

async function CustomerQuotations({ id }: { id: string }) {
  const rows = await listQuotations({ customerId: id });
  if (!rows.length) {
    return (
      <EmptyState
        icon={FileText}
        title="No quotations for this customer yet"
        action={
          <Button asChild>
            <Link href={`/quotations/new?customer=${id}`}>
              <FilePlus2 aria-hidden /> Create quotation
            </Link>
          </Button>
        }
      />
    );
  }
  return <QuotationList rows={rows} hideCompany />;
}

async function CustomerOrders({ id }: { id: string }) {
  const rows = (await getBoardTickets(id)).sort((a, b) => a.ticketNo.localeCompare(b.ticketNo));
  if (!rows.length) {
    return <EmptyState icon={SquareKanban} title="No orders yet" description="Services appear here once one of their quotations is marked Accepted." />;
  }
  const today = todayInIndia();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button asChild variant="outline" size="sm">
          <Link href={`/orders?customer=${id}`}>
            <SquareKanban aria-hidden /> Open on the board
          </Link>
        </Button>
      </div>
      <ul className="divide-y rounded-2xl border bg-card">
        {rows.map((t) => (
          <li key={t.id}>
            <Link
              href={`/orders?ticket=${t.id}${t.stage === "CANCELLED" ? "&cancelled=1" : ""}`}
              className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-4 hover:bg-secondary/60"
            >
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-primary tabular-nums">{t.ticketNo}</span>
                <span className="block text-sm text-muted-foreground">
                  {t.description} · Quotation {t.quoteNo}
                  {t.po ? ` · PO ${t.po.number}` : ""}
                  {t.invoice ? ` · Invoice ${t.invoice.number}` : ""}
                </span>
              </span>
              <span className="flex flex-wrap items-center gap-2">
                <StageChip stage={t.stage} />
                {t.invoice && t.stage === "PAYMENT"
                  ? invoiceChips(t.invoice, today).map((ch) => (
                      <ToneChip key={ch.label} tone={ch.tone} className="text-xs">
                        {ch.label}
                      </ToneChip>
                    ))
                  : null}
              </span>
              <span className="w-28 text-right font-semibold tabular-nums">{formatINR(t.totalPaise)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-10 w-2/3" />
      <Skeleton className="h-7 w-1/2" />
      <Skeleton className="h-12 w-60" />
      <div className="grid gap-6 lg:grid-cols-5">
        <Skeleton className="h-96 rounded-2xl lg:col-span-3" />
        <Skeleton className="h-48 rounded-2xl lg:col-span-2" />
      </div>
    </div>
  );
}
