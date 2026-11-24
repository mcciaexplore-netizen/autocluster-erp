import Link from "next/link";
import { Suspense } from "react";
import { CalendarClock, Handshake, Inbox, Play, ShoppingCart, Trophy, Wrench } from "lucide-react";
import { TodaysActivities } from "@/components/crm/todays-activities";
import { getCrmHomeStats, getCrmPickers, getTodaysActivities } from "@/lib/crm-data";
import { AlertTriangle, ArrowRight, Clock, FileClock, FilePlus2, FileText, IndianRupee, Receipt, UserPlus, Users, Wallet } from "lucide-react";
import { StatusChip } from "@/components/common/badges";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getDashboardStats, listQuotations } from "@/lib/data";
import { formatDate, money } from "@/lib/format";
import { getOrdersStats } from "@/lib/orders-data";
import { getInvHomeStats } from "@/lib/inventory-data";
import { getPlanningHomeStats } from "@/lib/planning-data";
import { can } from "@/lib/auth/can";
import { signedInUser } from "@/lib/auth/guard";
import { formatINRShort } from "@/lib/pricing";

export default function HomePage() {
  return (
    <Suspense fallback={<StatsSkeleton />}>
      <HomeBody />
    </Suspense>
  );
}

/** Only the shortcuts and sections the signed-in person can use. */
async function HomeBody() {
  const me = await signedInUser();
  const c = (p: Parameters<typeof can>[1]) => can(me, p);
  return (
    <>
      <div className="mb-8">
        <h1 className="font-title text-3xl text-primary md:text-4xl">Welcome</h1>
        <p className="mt-1.5 text-muted-foreground">What would you like to do today?</p>
      </div>

      {/* Phones: operators go straight to their jobs. */}
      {c("planning.operate") ? (
        <Link href="/planning/today" className="group mb-4 flex items-center gap-4 rounded-2xl bg-emerald-700 p-5 text-white shadow-md transition hover:bg-emerald-800 md:hidden">
          <span className="grid size-14 place-items-center rounded-xl bg-white/15">
            <Play className="size-7" aria-hidden />
          </span>
          <span className="flex-1">
            <span className="block text-xl font-semibold">Today&apos;s jobs</span>
            <span className="block text-sm text-white/80">Start, pause and finish your work</span>
          </span>
          <ArrowRight className="size-6" aria-hidden />
        </Link>
      ) : null}

      {c("customers.edit") || c("quotes.edit") ? (
        <div className="mb-8 grid gap-4 sm:grid-cols-2">
          {c("customers.edit") ? (
            <Link href="/customers/new" className="group flex items-center gap-4 rounded-2xl bg-primary p-6 text-primary-foreground shadow-md transition hover:bg-primary/90">
              <span className="grid size-14 place-items-center rounded-xl bg-white/10">
                <UserPlus className="size-7" aria-hidden />
              </span>
              <span className="flex-1">
                <span className="block text-xl font-semibold">Add new customer</span>
                <span className="block text-sm text-white/75">Save a company, its departments and services</span>
              </span>
              <ArrowRight className="size-6 transition group-hover:translate-x-1" aria-hidden />
            </Link>
          ) : null}
          {c("quotes.edit") ? (
            <Link href="/quotations/new" className="group flex items-center gap-4 rounded-2xl border-2 border-primary bg-card p-6 text-primary shadow-sm transition hover:bg-secondary">
              <span className="grid size-14 place-items-center rounded-xl bg-secondary">
                <FilePlus2 className="size-7" aria-hidden />
              </span>
              <span className="flex-1">
                <span className="block text-xl font-semibold">Create quotation</span>
                <span className="block text-sm text-muted-foreground">Prices are worked out for you</span>
              </span>
              <ArrowRight className="size-6 transition group-hover:translate-x-1" aria-hidden />
            </Link>
          ) : null}
        </div>
      ) : null}

      {c("crm.view") ? (
        <section className="mb-10" aria-labelledby="crm-heading">
          <div className="mb-4 flex items-center justify-between">
            <h2 id="crm-heading" className="text-xl font-semibold">
              Enquiries
            </h2>
            <Button asChild variant="ghost" size="sm">
              <Link href="/crm">
                Open CRM <ArrowRight aria-hidden />
              </Link>
            </Button>
          </div>
          <Suspense fallback={<StatsSkeleton />}>
            <CrmStats />
          </Suspense>
          <h3 id="today-heading" className="mt-6 mb-3 text-lg font-semibold">
            Today&apos;s activities
          </h3>
          <Suspense fallback={<RecentSkeleton />}>
            <Today />
          </Suspense>
        </section>
      ) : null}

      {c("customers.view") || c("quotes.view") ? (
        <Suspense fallback={<StatsSkeleton />}>
          <Stats />
        </Suspense>
      ) : null}

      {c("orders.view") ? (
        <section className="mt-10" aria-labelledby="orders-heading">
          <div className="mb-4 flex items-center justify-between">
            <h2 id="orders-heading" className="text-xl font-semibold">
              Orders &amp; Billing
            </h2>
            <Button asChild variant="ghost" size="sm">
              <Link href="/orders">
                Open board <ArrowRight aria-hidden />
              </Link>
            </Button>
          </div>
          <Suspense fallback={<StatsSkeleton />}>
            <OrderStats />
          </Suspense>
        </section>
      ) : null}

      {c("planning.view") ? (
        <section className="mt-10" aria-labelledby="planning-heading">
          <div className="mb-4 flex items-center justify-between">
            <h2 id="planning-heading" className="text-xl font-semibold">
              Planning
            </h2>
            <Button asChild variant="ghost" size="sm">
              <Link href="/planning">
                Open timeline <ArrowRight aria-hidden />
              </Link>
            </Button>
          </div>
          <Suspense fallback={<StatsSkeleton />}>
            <PlanningStats />
          </Suspense>
        </section>
      ) : null}

      {c("inventory.view") ? (
        <section className="mt-10" aria-labelledby="inventory-heading">
          <div className="mb-4 flex items-center justify-between">
            <h2 id="inventory-heading" className="text-xl font-semibold">
              Inventory
            </h2>
            <Button asChild variant="ghost" size="sm">
              <Link href="/inventory">
                Open inventory <ArrowRight aria-hidden />
              </Link>
            </Button>
          </div>
          <Suspense fallback={<StatsSkeleton />}>
            <InventoryStats />
          </Suspense>
        </section>
      ) : null}

      {c("quotes.view") ? (
        <section className="mt-10" aria-labelledby="recent-heading">
          <div className="mb-4 flex items-center justify-between">
            <h2 id="recent-heading" className="text-xl font-semibold">
              Recent quotations
            </h2>
            <Button asChild variant="ghost" size="sm">
              <Link href="/quotations">
                See all <ArrowRight aria-hidden />
              </Link>
            </Button>
          </div>
          <Suspense fallback={<RecentSkeleton />}>
            <RecentQuotations />
          </Suspense>
        </section>
      ) : null}
    </>
  );
}

async function CrmStats() {
  const s = await getCrmHomeStats();
  const items = [
    {
      label: "New enquiries this month",
      value: s.newThisMonth.toLocaleString("en-IN"),
      icon: Inbox,
      href: "/crm?created=thisMonth",
      hint: "Enquiries added this month",
      sub: null as string | null,
      alert: false,
    },
    {
      label: "Open enquiries value (before GST)",
      value: formatINRShort(s.openValuePaise),
      icon: Handshake,
      href: "/crm?state=open",
      hint: "Expected value of enquiries not yet won or lost, before GST",
      sub: `${s.openCount} open`,
      alert: false,
    },
    {
      label: "Activities due today",
      value: s.dueToday.toLocaleString("en-IN"),
      icon: CalendarClock,
      href: "/crm?activity=today",
      hint: "Calls, meetings and follow-ups planned for today",
      sub: s.overdue ? `${s.overdue} overdue` : "None overdue",
      alert: s.overdue > 0,
    },
    {
      label: "Won this month (before GST)",
      value: formatINRShort(s.wonValuePaise),
      icon: Trophy,
      href: "/crm?won=thisMonth",
      hint: "Enquiries won this month: the accepted quotation amount before GST, or the expected value when there is no quotation",
      sub: `${s.wonCount} won`,
      alert: false,
    },
  ];
  // The two value cards are sale prices: only for people who may see them.
  const shown = s.openValuePaise == null ? items.filter((i) => !i.label.includes("(before GST)")) : items;
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {shown.map(({ label, value, icon: Icon, href, hint, sub, alert }) => (
        <Link key={label} href={href} className="rounded-2xl" title={hint}>
          <Card className="h-full transition hover:border-primary/30">
            <CardContent className="flex flex-col gap-3">
              <Icon className="size-6 text-primary/70" aria-hidden />
              <div>
                <div className="text-2xl font-semibold text-primary tabular-nums md:text-3xl">{value}</div>
                <div className="text-sm text-muted-foreground">{label}</div>
                {sub ? <div className={alert ? "mt-1 text-sm font-semibold text-red-700" : "mt-1 text-xs text-muted-foreground"}>{sub}</div> : null}
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}

async function Today() {
  const [items, pickers] = await Promise.all([getTodaysActivities(), getCrmPickers()]);
  return <TodaysActivities items={items} team={pickers.team} />;
}

async function Stats() {
  const s = await getDashboardStats();
  const items = [
    { label: "Customers", value: s.customers.toLocaleString("en-IN"), icon: Users, href: "/customers" },
    { label: "Quotations this month", value: s.quotesThisMonth.toLocaleString("en-IN"), icon: FileText, href: "/quotations" },
    ...(s.totalThisMonth != null ? [{ label: "Total quoted this month", value: money(s.totalThisMonth), icon: IndianRupee, href: "/quotations" }] : []),
    { label: "Pending quotations", value: s.pending.toLocaleString("en-IN"), icon: Clock, href: "/quotations", hint: "Draft or sent, waiting for a reply" },
  ];
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {items.map(({ label, value, icon: Icon, href, hint }) => (
        <Link key={label} href={href} className="rounded-2xl" title={hint}>
          <Card className="h-full transition hover:border-primary/30">
            <CardContent className="flex flex-col gap-3">
              <Icon className="size-6 text-primary/70" aria-hidden />
              <div>
                <div className="text-2xl font-semibold text-primary tabular-nums md:text-3xl">{value}</div>
                <div className="text-sm text-muted-foreground">{label}</div>
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}

async function OrderStats() {
  const s = await getOrdersStats();
  const items = [
    { label: "Waiting for PO", value: s.waitingPo.toLocaleString("en-IN"), icon: FileClock, href: "/orders?stage=WAITING_PO", hint: "Services accepted, PO not received yet", tone: "" },
    { label: "Ready to bill", value: s.readyToBill.toLocaleString("en-IN"), icon: Receipt, href: "/orders?stage=BILLING", hint: "PO received, invoice not made yet", tone: "" },
    // Amounts only for people who may see sale prices.
    ...(s.outstandingPaise != null && s.overduePaise != null
      ? [
          { label: "Outstanding", value: formatINRShort(s.outstandingPaise), icon: Wallet, href: "/orders?stage=PAYMENT", hint: "Invoiced, not paid yet", tone: "" },
          {
            label: "Overdue",
            value: formatINRShort(s.overduePaise),
            icon: AlertTriangle,
            href: "/orders?overdue=1",
            hint: "Past the due date, not paid yet",
            tone: s.overduePaise > 0 ? "text-destructive" : "",
          },
        ]
      : []),
  ];
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {items.map(({ label, value, icon: Icon, href, hint, tone }) => (
        <Link key={label} href={href} className="rounded-2xl" title={hint}>
          <Card className="h-full transition hover:border-primary/30">
            <CardContent className="flex flex-col gap-3">
              <Icon className={`size-6 ${tone || "text-primary/70"}`} aria-hidden />
              <div>
                <div className={`text-2xl font-semibold tabular-nums md:text-3xl ${tone || "text-primary"}`}>{value}</div>
                <div className="text-sm text-muted-foreground">{label}</div>
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}

async function PlanningStats() {
  const s = await getPlanningHomeStats();
  const items = [
    { label: "Jobs to plan", value: s.toPlan, icon: CalendarClock, href: "/planning/jobs?notplanned=1", hint: "Accepted services not booked on a machine yet", tone: "" },
    { label: "Running now", value: s.running, icon: Play, href: "/planning/jobs?status=RUNNING", hint: "Jobs an operator has started", tone: s.running ? "text-emerald-700" : "" },
    { label: "Late jobs", value: s.late, icon: AlertTriangle, href: "/planning/jobs?late=1", hint: "Past the promised date, or planned to finish after it", tone: s.late ? "text-destructive" : "" },
    {
      label: "Machines not available",
      value: s.notAvailable,
      icon: Wrench,
      href: "/planning/machines",
      hint: "Broken down, under maintenance or blocked right now",
      tone: s.notAvailable ? "text-amber-700" : "",
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {items.map(({ label, value, icon: Icon, href, hint, tone }) => (
        <Link key={label} href={href} className="rounded-2xl" title={hint}>
          <Card className="h-full transition hover:border-primary/30">
            <CardContent className="flex flex-col gap-3">
              <Icon className={`size-6 ${tone || "text-primary/70"}`} aria-hidden />
              <div>
                <div className={`text-2xl font-semibold tabular-nums md:text-3xl ${tone || "text-primary"}`}>{value.toLocaleString("en-IN")}</div>
                <div className="text-sm text-muted-foreground">{label}</div>
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}

async function InventoryStats() {
  const s = await getInvHomeStats();
  const items = [
    {
      label: "Items to reorder",
      value: s.toReorder,
      icon: ShoppingCart,
      href: "/inventory/reorder",
      hint: "At or below the reorder level, or running out before new stock can arrive",
      tone: s.toReorder ? "text-amber-700" : "",
    },
    {
      label: `Expired or expiring (${s.warnDays} days)`,
      value: s.expiring,
      icon: CalendarClock,
      href: "/inventory/items?status=expiring",
      hint: "Items with a batch in stock that has expired or expires soon",
      tone: s.expiring ? "text-purple-700" : "",
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {items.map(({ label, value, icon: Icon, href, hint, tone }) => (
        <Link key={label} href={href} className="rounded-2xl" title={hint}>
          <Card className="h-full transition hover:border-primary/30">
            <CardContent className="flex flex-col gap-3">
              <Icon className={`size-6 ${tone || "text-primary/70"}`} aria-hidden />
              <div>
                <div className={`text-2xl font-semibold tabular-nums md:text-3xl ${tone || "text-primary"}`}>{value.toLocaleString("en-IN")}</div>
                <div className="text-sm text-muted-foreground">{label}</div>
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}

async function RecentQuotations() {
  const rows = (await listQuotations()).slice(0, 5);
  if (!rows.length) {
    return (
      <EmptyState
        icon={FileText}
        title="No quotations yet"
        description="Your quotations will show up here."
        action={
          <Button asChild>
            <Link href="/quotations/new">Create your first quotation</Link>
          </Button>
        }
      />
    );
  }
  return (
    <Card className="py-0">
      <ul className="divide-y">
        {rows.map((q) => (
          <li key={q.id}>
            <Link href={`/quotations/${q.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-4 hover:bg-secondary/60">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{q.companyName}</div>
                <div className="text-sm text-muted-foreground">
                  {q.quoteNo} · {formatDate(q.quoteDate)}
                </div>
              </div>
              <div className="font-semibold tabular-nums text-primary">{money(q.grandTotal)}</div>
              <StatusChip status={q.status} />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function StatsSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-32 rounded-2xl" />
      ))}
    </div>
  );
}

function RecentSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-16 rounded-xl" />
      ))}
    </div>
  );
}
