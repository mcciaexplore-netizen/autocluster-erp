import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight, Clock, FilePlus2, FileText, IndianRupee, UserPlus, Users } from "lucide-react";
import { StatusChip } from "@/components/common/badges";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getDashboardStats, listQuotations } from "@/lib/data";
import { formatDate, money } from "@/lib/format";

export default function HomePage() {
  return (
    <>
      <div className="mb-8">
        <h1 className="font-title text-3xl text-primary md:text-4xl">Welcome</h1>
        <p className="mt-1.5 text-muted-foreground">What would you like to do today?</p>
      </div>

      <div className="mb-8 grid gap-4 sm:grid-cols-2">
        <Link
          href="/customers/new"
          className="group flex items-center gap-4 rounded-2xl bg-primary p-6 text-primary-foreground shadow-md transition hover:bg-primary/90"
        >
          <span className="grid size-14 place-items-center rounded-xl bg-white/10">
            <UserPlus className="size-7" aria-hidden />
          </span>
          <span className="flex-1">
            <span className="block text-xl font-semibold">Add new customer</span>
            <span className="block text-sm text-white/75">Save a company, its departments and services</span>
          </span>
          <ArrowRight className="size-6 transition group-hover:translate-x-1" aria-hidden />
        </Link>
        <Link
          href="/quotations/new"
          className="group flex items-center gap-4 rounded-2xl border-2 border-primary bg-card p-6 text-primary shadow-sm transition hover:bg-secondary"
        >
          <span className="grid size-14 place-items-center rounded-xl bg-secondary">
            <FilePlus2 className="size-7" aria-hidden />
          </span>
          <span className="flex-1">
            <span className="block text-xl font-semibold">Create quotation</span>
            <span className="block text-sm text-muted-foreground">Prices are worked out for you</span>
          </span>
          <ArrowRight className="size-6 transition group-hover:translate-x-1" aria-hidden />
        </Link>
      </div>

      <Suspense fallback={<StatsSkeleton />}>
        <Stats />
      </Suspense>

      <section className="mt-10" aria-labelledby="recent-heading">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="recent-heading" className="text-xl font-semibold">Recent quotations</h2>
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
    </>
  );
}

async function Stats() {
  const s = await getDashboardStats();
  const items = [
    { label: "Customers", value: s.customers.toLocaleString("en-IN"), icon: Users, href: "/customers" },
    { label: "Quotations this month", value: s.quotesThisMonth.toLocaleString("en-IN"), icon: FileText, href: "/quotations" },
    { label: "Total quoted this month", value: money(s.totalThisMonth), icon: IndianRupee, href: "/quotations" },
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
