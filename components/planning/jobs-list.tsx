"use client";

import { DeptChips } from "@/components/planning/dept-chips";
import type { DeptChoice } from "@/lib/planning/dept-scope";
import { CheckCheck, Download, Loader2, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useCan } from "@/components/auth/permissions-provider";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { bulkJobsAction, bulkMarkDoneAction } from "@/lib/actions/jobs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/format";
import type { JobRow } from "@/lib/planning-data";
import { formatHours, formatWhen } from "@/lib/planning/hours";
import { JOB_STATUS_UI, type JobStatusName } from "@/lib/planning/job-status";
import { cn } from "@/lib/utils";

const ALL = "all";
const NONE = "none";

export function JobsList({ jobs, deptChoice, machines, team }: { jobs: JobRow[]; deptChoice: DeptChoice; machines: { id: string; name: string }[]; team: { id: string; name: string }[] }) {
  const params = useSearchParams();
  // Ticking jobs (to change operator, priority or mark done) needs "planning.book".
  const canBulk = useCan()("planning.book");
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [picked, setPicked] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const [doneOpen, setDoneOpen] = useState(false);
  const [doneNote, setDoneNote] = useState("");
  const set = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    p.delete("job");
    router.replace(`${pathname}${p.size ? `?${p}` : ""}`, { scroll: false });
  };
  useEffect(() => {
    const t = setTimeout(() => (params.get("q") ?? "") !== q.trim() && set({ q: q.trim() || null }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  const open = (id: string) => {
    const p = new URLSearchParams(params);
    p.set("job", id);
    router.replace(`${pathname}?${p}`, { scroll: false });
  };
  const pick = (k: string, label: string, opts: { value: string; label: string }[], any: string) => (
    <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
      {label}
      <Select value={params.get(k) ?? ALL} onValueChange={(v) => set({ [k]: v === ALL ? null : v })}>
        <SelectTrigger className="h-10 w-44 bg-card text-sm text-foreground">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{any}</SelectItem>
          {opts.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
  const chip = (k: string, label: string) => {
    const on = params.get(k) === "1";
    return (
      <button type="button" aria-pressed={on} onClick={() => set({ [k]: on ? null : "1" })} className={cn("h-10 rounded-full border px-4 text-sm font-medium", on ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-secondary")}>
        {label}
      </button>
    );
  };
  const any = ["q", "status", "machine", "operator", "promised", "late", "notplanned", "over", "check"].some((k) => params.get(k));
  const bulk = (change: { operatorId?: string | null; priority?: "NORMAL" | "URGENT" }) =>
    start(async () => {
      const r = await bulkJobsAction(picked, change);
      if (!r.ok) return void toast.error(r.message);
      toast.success(`${r.data.updated} ${r.data.updated === 1 ? "job" : "jobs"} updated`);
      setPicked([]);
      router.refresh();
    });
  const exportHref = `/api/planning/jobs/export?${new URLSearchParams([...params.entries()].filter(([k]) => k !== "job"))}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search ticket no., customer or service" className="h-11 pl-9" aria-label="Search jobs" />
        </div>
        <DeptChips choice={deptChoice} />
        <div className="flex flex-wrap items-end gap-3">
          {pick("status", "Status", (Object.keys(JOB_STATUS_UI) as JobStatusName[]).map((s) => ({ value: s, label: JOB_STATUS_UI[s].label })), "Any status")}
          {pick("machine", "Machine", machines.map((m) => ({ value: m.id, label: m.name })), "Any machine")}
          {pick("operator", "Operator", team.map((t) => ({ value: t.id, label: t.name })), "Anyone")}
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            Promised by
            <Input type="date" className="h-10 w-40 text-sm" value={params.get("promised") ?? ""} onChange={(e) => set({ promised: e.target.value || null })} />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {chip("late", "Late")}
          {chip("notplanned", "Not planned")}
          {chip("over", "Actual over quoted")}
          {chip("check", "Check if work is done")}
          {any ? (
            <Button variant="ghost" size="sm" onClick={() => (setQ(""), router.replace(pathname, { scroll: false }))}>
              <X aria-hidden /> Clear filters
            </Button>
          ) : null}
          <Button asChild variant="outline" size="sm" className="ml-auto">
            <a href={exportHref} download>
              <Download aria-hidden /> Download as Excel
            </a>
          </Button>
        </div>
      </div>

      {picked.length ? (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-2xl border bg-card p-3 shadow-sm">
          <span className="text-sm font-medium">{picked.length} ticked</span>
          <Select onValueChange={(v) => bulk({ operatorId: v === NONE ? null : v })} disabled={pending}>
            <SelectTrigger className="h-9 w-44">
              <SelectValue placeholder="Set operator" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Nobody</SelectItem>
              {team.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select onValueChange={(v) => bulk({ priority: v as "NORMAL" | "URGENT" })} disabled={pending}>
            <SelectTrigger className="h-9 w-40">
              <SelectValue placeholder="Set priority" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="NORMAL">Normal</SelectItem>
              <SelectItem value="URGENT">Urgent</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={() => setDoneOpen(true)} disabled={pending}>
            <CheckCheck aria-hidden /> Mark done
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setPicked([])}>
            Untick all
          </Button>
        </div>
      ) : null}

      {!jobs.length ? (
        <p className="rounded-2xl border bg-card p-8 text-center text-muted-foreground">No jobs match.</p>
      ) : (
        <>
          {/* Desktop: table */}
          <div className="hidden overflow-x-auto rounded-2xl border bg-card lg:block">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-muted-foreground">
                <tr>
                  <th className="w-10 px-3 py-2">
                    {canBulk ? <Checkbox aria-label="Tick all" checked={picked.length === jobs.length} onCheckedChange={(v) => setPicked(v === true ? jobs.map((j) => j.id) : [])} /> : null}
                  </th>
                  <th className="px-2 py-2 font-medium">Job</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                  <th className="px-2 py-2 font-medium">Machine(s)</th>
                  <th className="px-2 py-2 font-medium">Planned</th>
                  <th className="px-2 py-2 font-medium">Promised</th>
                  <th className="px-2 py-2 text-right font-medium">Needed / planned / actual</th>
                  <th className="px-2 py-2 font-medium">Operator</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {jobs.map((j) => (
                  <tr key={j.id} className="cursor-pointer hover:bg-secondary/50" onClick={() => open(j.id)}>
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      {canBulk ? <Checkbox aria-label={`Tick ${j.ticketNo}`} checked={picked.includes(j.id)} onCheckedChange={(v) => setPicked((p) => (v === true ? [...p, j.id] : p.filter((x) => x !== j.id)))} /> : null}
                    </td>
                    <td className="px-2 py-2">
                      <button type="button" className="text-left font-medium text-primary tabular-nums hover:underline">
                        {j.ticketNo}
                      </button>
                      <span className="block text-xs text-muted-foreground">
                        {j.company} · {j.service}
                      </span>
                    </td>
                    <td className="px-2 py-2">
                      <Chips j={j} />
                    </td>
                    <td className="px-2 py-2 text-xs">{j.machines.join(", ") || "-"}</td>
                    <td className="px-2 py-2 text-xs whitespace-nowrap">{j.plannedStart ? `${formatWhen(j.plannedStart)} to ${formatWhen(j.plannedEnd!)}` : "-"}</td>
                    <td className={cn("px-2 py-2 text-xs whitespace-nowrap", j.late && "font-semibold text-red-700")}>{j.promisedDate ? formatDate(j.promisedDate) : "-"}</td>
                    <td className="px-2 py-2 text-right text-xs whitespace-nowrap tabular-nums">
                      {j.hoursNeeded != null ? formatHours(j.hoursNeeded) : "-"} / {formatHours(j.plannedHours)} /{" "}
                      <span className={cn(j.overQuoted && "font-semibold text-red-700")}>{formatHours(j.actualHours)}</span>
                    </td>
                    <td className="px-2 py-2 text-xs">{j.operator ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Phone: cards */}
          <ul className="flex flex-col gap-2 lg:hidden">
            {jobs.map((j) => (
              <li key={j.id}>
                <button type="button" onClick={() => open(j.id)} className="flex w-full flex-col gap-1 rounded-2xl border bg-card p-3 text-left">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-primary tabular-nums">{j.ticketNo}</span>
                    <Chips j={j} />
                  </span>
                  <span className="text-sm">
                    {j.company} · {j.service}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {j.plannedStart ? `${j.machines.join(", ")}: ${formatWhen(j.plannedStart)}` : "Not booked"}
                    {j.promisedDate ? ` · promised ${formatDate(j.promisedDate)}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <Dialog open={doneOpen} onOpenChange={setDoneOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Mark {picked.length} {picked.length === 1 ? "job" : "jobs"} as done?
            </DialogTitle>
            <DialogDescription>One completion note for all of them. Their future bookings are freed.</DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Completion note
            <Textarea rows={3} value={doneNote} onChange={(e) => setDoneNote(e.target.value)} placeholder="e.g. Work was done before planning started" maxLength={2000} autoFocus />
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDoneOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={pending || doneNote.trim().length < 3}
              onClick={() =>
                start(async () => {
                  const r = await bulkMarkDoneAction(picked, doneNote);
                  if (!r.ok) return void toast.error(r.message);
                  toast.success(`${r.data.done} ${r.data.done === 1 ? "job" : "jobs"} marked done`);
                  setPicked([]);
                  setDoneNote("");
                  setDoneOpen(false);
                  router.refresh();
                })
              }
            >
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : <CheckCheck aria-hidden />} Mark done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <p className="text-sm text-muted-foreground">
        {jobs.length} {jobs.length === 1 ? "job" : "jobs"}
        {jobs.length >= 500 ? " (the first 500; narrow the filters to see others)" : ""}.{" "}
        <Link href="/planning" className="underline">
          Open the timeline
        </Link>
      </p>
    </div>
  );
}

function Chips({ j }: { j: JobRow }) {
  const s = JOB_STATUS_UI[j.status];
  return (
    <span className="flex flex-wrap gap-1">
      <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", s.className)}>{s.label}</span>
      {j.priority === "URGENT" ? <span className="rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-800">Urgent</span> : null}
      {j.late ? <span className="rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-800">Late</span> : null}
      {j.overQuoted ? <span className="rounded-full border border-red-200 bg-white px-2 py-0.5 text-xs font-medium text-red-800">Over quoted</span> : null}
      {j.checkWorkDone ? <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900">Invoiced before planning started: check if work is done</span> : null}
    </span>
  );
}
