import type { Metadata } from "next";
import { ClipboardCheck } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { EmptyState } from "@/components/common/empty-state";
import { ListSkeleton } from "@/components/common/form-skeleton";
import { PageHeader } from "@/components/common/page-header";
import { StartCountButton } from "@/components/inventory/counts";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { getInvLists, listCounts } from "@/lib/inventory-data";
import { formatINRShort } from "@/lib/pricing";

/** Reads who is signed in (and stops with forbidden() when they may not see it), so it blocks on the server: no instant-navigation validation. */
export const instant = false;

export const metadata: Metadata = { title: "Stock count" };

export default function Page() {
  return (
    <div>
      <PageHeader title="Stock count" description="Count what is on the shelves. Differences become one Stock adjusted record." />
      <Suspense fallback={<ListSkeleton rows={4} />}>
        <Counts />
      </Suspense>
    </div>
  );
}

async function Counts() {
  const [counts, lists] = await Promise.all([listCounts(), getInvLists()]);
  const open = counts.filter((c) => c.status === "IN_PROGRESS");
  return (
    <div className="flex flex-col gap-6">
      <div>
        <StartCountButton categories={lists.categories.filter((c) => c.isActive)} departments={lists.departments} team={lists.team.filter((t) => t.isActive)} />
        {open.length ? <p className="mt-2 text-sm text-muted-foreground">More than one count can be open, as long as they don&apos;t share any items.</p> : null}
      </div>
      {open.map((o) => (
        <section key={o.id} className="flex flex-col gap-3 rounded-2xl border-2 border-primary/30 bg-secondary p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold">
              Count <span className="tabular-nums">{o.countNo}</span> is open
            </p>
            <p className="text-sm text-muted-foreground">
              {o.label} · {o.counted} of {o.lines} counted · started {formatDate(o.startedAt)}
            </p>
          </div>
          <Button asChild size="lg">
            <Link href={`/inventory/counts/${o.id}`}>Continue counting</Link>
          </Button>
        </section>
      ))}

      {!counts.length ? (
        <EmptyState icon={ClipboardCheck} title="No counts yet" description="Start a stock count to check the shelves against the stock in the app." />
      ) : (
        <ul className="divide-y rounded-2xl border bg-card">
          {counts.map((c) => {
            const net = c.gainPaise - c.lossPaise;
            return (
              <li key={c.id}>
                <Link href={`/inventory/counts/${c.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3.5 hover:bg-secondary/60 sm:px-5">
                  <span className="w-24 shrink-0 text-sm text-muted-foreground">{formatDate(c.completedAt ?? c.startedAt)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-primary tabular-nums">{c.countNo}</span>
                      {c.status === "IN_PROGRESS" ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">Open</span>
                      ) : (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900">Completed</span>
                      )}
                    </span>
                    <span className="block truncate text-sm text-muted-foreground">
                      {[c.label, `${c.counted} of ${c.lines} counted`, c.adjustment ? `adjusted by ${c.adjustment.docNo}` : c.status === "COMPLETED" ? "no differences" : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <span className="text-sm text-muted-foreground">{c.doneBy ?? ""}</span>
                  <span className="w-32 text-right font-semibold tabular-nums">
                    {c.status === "COMPLETED" && c.adjustment ? `${net < 0 ? "Loss" : "Gain"} ${formatINRShort(Math.abs(net))}` : ""}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
