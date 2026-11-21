import { CalendarClock } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

const dayMonth = (iso: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).format(new Date(iso));

/** "To plan", "Planned 24 Nov, SLA 7000 HD", "Running", "On hold", "Done", "Handed over". */
export function jobChipText(job: { status: string; bookedOn: string | null; machine: string | null }): string {
  switch (job.status) {
    case "TO_PLAN":
      return "To plan";
    case "PLANNED":
      return job.bookedOn ? `Planned ${dayMonth(job.bookedOn)}${job.machine ? `, ${shortMachine(job.machine)}` : ""}` : "Planned";
    case "RUNNING":
      return "Running";
    case "ON_HOLD":
      return "On hold";
    case "DONE":
      return "Done";
    case "HANDED_OVER":
      return "Handed over";
    default:
      return "Cancelled";
  }
}

/** "SLA - 3D Systems 7000 HD" -> "SLA 7000 HD"; long names are cut to the first words. */
function shortMachine(name: string) {
  const sla = /^SLA - 3D Systems (.+)$/.exec(name);
  if (sla) return `SLA ${sla[1]}`;
  return name.length > 22 ? `${name.slice(0, 20).trimEnd()}…` : name;
}

const TONE: Record<string, string> = {
  TO_PLAN: "border-amber-300 bg-amber-50 text-amber-900",
  PLANNED: "border-blue-200 bg-blue-50 text-blue-900",
  RUNNING: "border-emerald-300 bg-emerald-50 text-emerald-900",
  ON_HOLD: "border-orange-300 bg-orange-50 text-orange-900",
  DONE: "border-slate-200 bg-slate-100 text-slate-700",
  HANDED_OVER: "border-slate-200 bg-white text-slate-600",
};

/** The job's state on an Orders ticket card; opens the job in Planning. */
export function JobChip({ job }: { job: { id: string; status: string; bookedOn: string | null; machine: string | null } }) {
  if (job.status === "CANCELLED") return null;
  return (
    <Link
      href={`/planning/jobs?job=${job.id}`}
      onPointerDown={(e) => e.stopPropagation()}
      className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium hover:underline", TONE[job.status] ?? TONE.DONE)}
      title="Open the job in Planning"
    >
      <CalendarClock className="size-3" aria-hidden />
      {jobChipText(job)}
    </Link>
  );
}
