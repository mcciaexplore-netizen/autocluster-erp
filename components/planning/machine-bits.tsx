import { cn } from "@/lib/utils";
import { LIVE_CHIP, type LiveStatus } from "@/lib/planning/live-status";
import { MACHINE_STATUS, type MachineStatusName } from "@/lib/validation/planning";

const chip = "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap";

/** What a machine is doing right now: Running, Booked not started, Free, out of use, or Inactive. */
export function LiveStatusChip({ live, className }: { live: LiveStatus; className?: string }) {
  return (
    <span className={cn(chip, "max-w-full truncate", LIVE_CHIP[live.kind], className)} title={live.label}>
      {live.label}
    </span>
  );
}

/** The machine's setting (In service, Under maintenance, Breakdown, Inactive): for the machine form only. */
export function MachineStatusChip({ status }: { status: MachineStatusName }) {
  const s = MACHINE_STATUS[status];
  return <span className={cn(chip, s.className)}>{s.label}</span>;
}

/** Small facts about a machine: not on rate card, NABL, day and night, jobs at the same time. */
export function MachineChips({ m }: { m: { services: unknown[]; nablAccredited: boolean; runsNonstop: boolean; parallelJobs: number } }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {!m.services.length ? <span className={cn(chip, "border-slate-200 bg-slate-100 text-slate-600")}>Not on rate card</span> : null}
      {m.nablAccredited ? <span className={cn(chip, "border-sky-200 bg-sky-50 text-sky-900")}>NABL</span> : null}
      {m.runsNonstop ? <span className={cn(chip, "border-violet-200 bg-violet-50 text-violet-900")}>Day and night</span> : null}
      {m.parallelJobs > 1 ? <span className={cn(chip, "border-slate-200 bg-white text-slate-700")}>{m.parallelJobs} jobs at the same time</span> : null}
    </span>
  );
}

export const pctText = (v: number | null) => (v == null ? "Not available" : `${Math.round(v)}%`);
