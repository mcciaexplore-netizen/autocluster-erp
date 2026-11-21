import type { Metadata } from "next";
import { Cog, Plus } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { EmptyState } from "@/components/common/empty-state";
import { ListSkeleton } from "@/components/common/form-skeleton";
import { PageHeader } from "@/components/common/page-header";
import { BlockTimeButton } from "@/components/planning/block-time";
import { MachineChips, MachineStatusChip, pctText } from "@/components/planning/machine-bits";
import { StillBrokenDown } from "@/components/planning/still-broken";
import { Button } from "@/components/ui/button";
import { listMachines } from "@/lib/planning-data";
import { formatWhen } from "@/lib/planning/hours";
import { BLOCK_TYPES } from "@/lib/validation/planning";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Machines" };

export default function MachinesPage() {
  return (
    <div>
      <Suspense fallback={<ListSkeleton rows={6} />}>
        <List />
      </Suspense>
    </div>
  );
}

async function List() {
  const { departments, machines } = await listMachines();
  const picks = machines.filter((m) => m.isActive).map((m) => ({ id: m.id, name: m.name, code: m.code, deptCode: m.deptCode }));
  return (
    <>
      <PageHeader
        title="Machines"
        description="Every machine, what it's doing now, and how busy it is this week."
        actions={
          <div className="flex flex-wrap gap-2">
            <BlockTimeButton machines={picks} />
            <Button asChild>
              <Link href="/planning/machines/new">
                <Plus aria-hidden /> Add machine
              </Link>
            </Button>
          </div>
        }
      />
      {!machines.length ? (
        <EmptyState icon={Cog} title="No machines yet" description="Add the machines and chambers that jobs are booked on." />
      ) : (
        <div className="flex flex-col gap-8">
          {departments.map((d) => {
            const list = machines.filter((m) => m.deptCode === d.code);
            if (!list.length) return null;
            return (
              <section key={d.code} aria-labelledby={`dept-${d.code}`}>
                <h2 id={`dept-${d.code}`} className="mb-3 text-lg font-semibold">
                  {d.code} - {d.name} <span className="text-sm font-normal text-muted-foreground">({list.length})</span>
                </h2>
                <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {list.map((m) => {
                    const pct = m.use.bookedPct;
                    return (
                      <li key={m.id} className={cn("flex h-full flex-col rounded-2xl border bg-card transition hover:border-primary/30", !m.isActive && "opacity-70")}>
                        <Link href={`/planning/machines/${m.id}`} className="flex flex-1 flex-col gap-2 rounded-2xl p-4">
                          <span className="flex items-start justify-between gap-2">
                            <span className="min-w-0">
                              <span className="block font-semibold">{m.name}</span>
                              <span className="text-sm text-muted-foreground tabular-nums">{[m.code, m.makeModel].filter(Boolean).join(" · ")}</span>
                            </span>
                            <MachineStatusChip status={m.status} />
                          </span>
                          <MachineChips m={m} />
                          <span className="text-sm">
                            {m.blockedNow ? (
                              <span className="font-medium text-slate-700">Now: not available ({BLOCK_TYPES[m.blockedNow.type].toLowerCase()})</span>
                            ) : m.now.length ? (
                              <span className="font-medium text-emerald-800">
                                Now: Job {m.now[0].ticketNo} for {m.now[0].company}
                                {m.now.length > 1 ? ` (+${m.now.length - 1} more)` : ""}
                              </span>
                            ) : (
                              <span className="font-medium text-emerald-700">Free</span>
                            )}
                          </span>
                          <span className="text-sm text-muted-foreground">{m.next ? `Next: ${formatWhen(m.next.startAt)}, ${m.next.ticketNo}` : "Nothing booked next"}</span>
                          <span className="mt-auto flex items-center gap-3 pt-1">
                            <span className="h-2 flex-1 overflow-hidden rounded-full bg-secondary" aria-hidden>
                              <span className={cn("block h-full rounded-full", pct != null && pct >= 90 ? "bg-red-500" : pct != null && pct >= 70 ? "bg-amber-500" : "bg-primary")} style={{ width: `${Math.min(100, pct ?? 0)}%` }} />
                            </span>
                            <span className="text-sm whitespace-nowrap text-muted-foreground">Machine use this week: {pctText(pct)}</span>
                          </span>
                        </Link>
                        {m.overdueBreakdown ? (
                          <div className="px-4 pb-4">
                            <StillBrokenDown compact machineId={m.id} machineName={m.name} expectedEnd={m.overdueBreakdown.toISOString()} />
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
