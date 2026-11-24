"use client";

import { AlertTriangle, CalendarPlus, ExternalLink, FileText, History, Loader2, MoveRight, PackageMinus, Paperclip, Save, Trash2, Wrench, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { useConfirm } from "@/components/common/confirm";
import { FileField } from "@/components/orders/file-field";
import { useCan } from "@/components/auth/permissions-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { addJobFileAction, cancelBookingAction, extendHoldAction, loadJobPanelAction, removeJobFileAction, saveJobDetailsAction, type JobPanelData } from "@/lib/actions/jobs";
import type { BlobEnv, UploadedFile } from "@/lib/files";
import { formatDate } from "@/lib/format";
import { keptAfterMaterials } from "@/lib/inventory/materials";
import { formatHours, formatWhen } from "@/lib/planning/hours";
import { JOB_STATUS_UI } from "@/lib/planning/job-status";
import { formatINR } from "@/lib/pricing";
import { dayPlus } from "@/lib/planning/hours";
import { todayInIndia } from "@/lib/tickets";
import { cn } from "@/lib/utils";
import { BookTimeDialog, type BookJob, type MoveBooking } from "./book-time";

const NONE = "none";

/** Opens the job panel for `?job=<id>` on any Planning page. */
export function JobPanelHost({ env }: { env: BlobEnv }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const jobId = params.get("job");
  const moveId = params.get("move");
  const another = params.get("another") === "1";
  const close = () => {
    const p = new URLSearchParams(params);
    for (const k of ["job", "move", "another"]) p.delete(k);
    router.replace(`${pathname}${p.size ? `?${p}` : ""}`, { scroll: false });
  };
  return <JobPanel jobId={jobId} onClose={close} env={env} openMove={moveId ? { bookingId: moveId, another } : undefined} />;
}

export function JobPanel({ jobId, onClose, env, openMove }: { jobId: string | null; onClose: () => void; env: BlobEnv; openMove?: { bookingId: string; another: boolean } }) {
  const [data, setData] = useState<JobPanelData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    if (!jobId) return;
    let live = true;
    loadJobPanelAction(jobId).then((r) => {
      if (!live) return;
      if (r.ok) {
        setData(r.data);
        setError(null);
      } else setError(r.message);
    });
    return () => {
      live = false;
    };
  }, [jobId, version]);
  const d = data && data.detail.job.id === jobId ? data : null;
  return (
    <Sheet open={!!jobId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="gap-0 overflow-y-auto p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
        {d ? (
          <Body data={d} reload={reload} env={env} openMove={openMove} />
        ) : (
          <>
            <SheetHeader className="border-b p-5">
              <SheetTitle>{error ? "Job not found" : "Loading job..."}</SheetTitle>
              <SheetDescription>{error ?? "One moment."}</SheetDescription>
            </SheetHeader>
            {!error ? (
              <div className="flex flex-col gap-3 p-5">
                <Skeleton className="h-24" />
                <Skeleton className="h-40" />
              </div>
            ) : null}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, icon, children, action }: { title: string; icon: React.ReactNode; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="border-b p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-semibold">
          {icon} {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Body({ data, reload, env, openMove }: { data: JobPanelData; reload: () => void; env: BlobEnv; openMove?: { bookingId: string; another: boolean } }) {
  const router = useRouter();
  const { detail: d, options, materials } = data;
  const j = d.job;
  const [dialog, confirm] = useConfirm();
  const [pending, start] = useTransition();
  const [booking, setBooking] = useState<{ move?: MoveBooking; pickAnother?: boolean } | null>(() => {
    // Opened from a clash ("Pick another machine"): go straight to moving that booking.
    const b = openMove && d.bookings.find((x) => x.id === openMove.bookingId);
    return b ? { move: { id: b.id, machineId: b.machineId, start: new Date(b.startAt).toISOString(), hours: Number(b.hours), started: new Date(b.startAt) <= new Date() }, pickAnother: openMove.another } : null;
  });
  const [form, setForm] = useState({
    hours: j.hoursNeeded != null ? String(Number(j.hoursNeeded)) : "",
    promised: j.promisedDate ?? "",
    priority: j.priority,
    operator: j.operatorId ?? "",
    instructions: j.instructions ?? "",
  });
  const [file, setFile] = useState<UploadedFile | null>(null);
  const today = todayInIndia();
  const needed = j.hoursNeeded != null ? Number(j.hoursNeeded) : null;
  const unplanned = needed != null ? Math.max(0, needed - d.plannedHours) : 0;
  const can = useCan();
  // Changing the job (details, bookings, files) needs "planning.book" for its department; others see it read-only.
  const open = !["DONE", "HANDED_OVER", "CANCELLED"].includes(j.status) && can("planning.book", { dept: d.ticket.deptCode });
  const late = !!j.promisedDate && open && today > j.promisedDate;
  const status = JOB_STATUS_UI[j.status];
  const bookJob: BookJob = {
    id: j.id,
    ticketNo: d.ticket.ticketNo,
    company: d.ticket.company,
    service: d.ticket.service,
    serviceId: d.serviceId,
    isCustomItem: d.isCustomItem,
    waitingForPo: d.ticket.stage === "WAITING_PO",
    promisedDate: j.promisedDate,
    operatorId: j.operatorId,
    unplannedHours: unplanned,
  };
  const after = () => (reload(), router.refresh());
  const dirty =
    form.hours !== (j.hoursNeeded != null ? String(Number(j.hoursNeeded)) : "") ||
    form.promised !== (j.promisedDate ?? "") ||
    form.priority !== j.priority ||
    form.operator !== (j.operatorId ?? "") ||
    form.instructions !== (j.instructions ?? "");

  const saveDetails = () =>
    start(async () => {
      const h = form.hours.trim() ? Number(form.hours) : null;
      if (h != null && !(h > 0)) return void toast.error("Enter the time needed in hours, e.g. 6 or 2.5.");
      const r = await saveJobDetailsAction(j.id, { hoursNeeded: h, promisedDate: form.promised || null, priority: form.priority, operatorId: form.operator || null, instructions: form.instructions || null });
      if (!r.ok) return void toast.error(r.message);
      toast.success("Job saved");
      after();
    });

  const quoted = d.quotedHours;
  const overPct = quoted && d.actualHours > 0 ? ((d.actualHours - quoted) / quoted) * 100 : null;
  const kept = materials && materials.recorded && materials.taxablePaise != null && materials.costPaise != null ? keptAfterMaterials(materials.taxablePaise, materials.costPaise) : null;

  return (
    <>
      <SheetHeader className="border-b p-5">
        <SheetTitle className="flex flex-wrap items-center gap-2 tabular-nums">
          {d.ticket.ticketNo}
          <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium", status.className)}>{status.label}</span>
          {j.priority === "URGENT" ? <span className="rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-800">Urgent</span> : null}
          {late ? <span className="rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-800">Late</span> : null}
        </SheetTitle>
        <SheetDescription className="text-base text-foreground">
          {d.ticket.company} · {d.ticket.service}
          <span className="block text-sm text-muted-foreground">
            {d.ticket.quantityText}
            {j.promisedDate ? ` · promised ${formatDate(j.promisedDate)}` : ""}
            {d.ticket.stage === "WAITING_PO" ? " · waiting for PO" : ""}
          </span>
        </SheetDescription>
      </SheetHeader>

      {j.checkWorkDone && open ? (
        <p className="mx-5 mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">Invoiced before planning started: check if work is done.</p>
      ) : null}
      {j.status === "ON_HOLD" && j.holdReason ? (
        <p className="mx-5 mt-4 rounded-xl border border-orange-300 bg-orange-50 p-3 text-sm text-orange-950">On hold: {j.holdReason}</p>
      ) : null}

      <Section title="Job details" icon={<Wrench className="size-4" />}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Time needed (hours)
            <Input inputMode="decimal" value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} placeholder="e.g. 6" disabled={!open} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Promised date
            <Input type="date" value={form.promised} onChange={(e) => setForm({ ...form, promised: e.target.value })} disabled={!open} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Priority
            <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v as "NORMAL" | "URGENT" })} disabled={!open}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NORMAL">Normal</SelectItem>
                <SelectItem value="URGENT">Urgent</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Default operator
            <Select value={form.operator || NONE} onValueChange={(v) => setForm({ ...form, operator: v === NONE ? "" : v })} disabled={!open}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Not chosen</SelectItem>
                {options.team.filter((t) => t.id === form.operator || !t.depts || !d.ticket.deptCode || t.depts.includes(d.ticket.deptCode)).map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2">
            Instructions
            <Textarea rows={2} value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} placeholder="e.g. Test standard, conditions, drawing revision" maxLength={4000} disabled={!open} />
          </label>
        </div>
        {open ? (
          <div className="mt-3 flex justify-end">
            <Button size="sm" onClick={saveDetails} disabled={pending || !dirty}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />} Save details
            </Button>
          </div>
        ) : null}
      </Section>

      <Section
        title="Plan"
        icon={<CalendarPlus className="size-4" />}
        action={
          open ? (
            <Button size="sm" onClick={() => setBooking({})}>
              <CalendarPlus aria-hidden /> Book time
            </Button>
          ) : null
        }
      >
        <p className="mb-2 text-sm font-medium">
          {needed != null ? `Planned ${formatHours(d.plannedHours)} of ${formatHours(needed)}` : d.plannedHours ? `Planned ${formatHours(d.plannedHours)} (time needed not set)` : "Not booked yet"}
        </p>
        {d.bookings.length ? (
          <ul className="flex flex-col gap-2">
            {d.bookings.map((b) => {
              const started = new Date(b.startAt) <= new Date();
              const expired = b.isTentative && b.holdUntil && b.holdUntil < today;
              return (
                <li key={b.id} className={cn("rounded-xl border p-3 text-sm", b.isTentative ? (expired ? "border-red-300 bg-red-50" : "border-amber-300 bg-[repeating-linear-gradient(135deg,#fffbeb_0_6px,#fef3c7_6px_12px)]") : "bg-card")}>
                  <p className="font-medium">{b.machine}</p>
                  <p>
                    {formatWhen(new Date(b.startAt))} to {formatWhen(new Date(b.endAt))} · {formatHours(Number(b.hours))}
                    {b.operator ? ` · ${b.operator}` : ""}
                  </p>
                  {b.isTentative ? (
                    <p className={cn("text-xs", expired ? "font-semibold text-red-800" : "text-amber-900")}>
                      {expired ? "Hold expired" : "Tentative: waiting for PO"}, held until {formatDate(b.holdUntil)}
                    </p>
                  ) : null}
                  {b.note ? <p className="text-xs text-muted-foreground">{b.note}</p> : null}
                  {open ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Button size="sm" variant="outline" className="bg-white" onClick={() => setBooking({ move: { id: b.id, machineId: b.machineId, start: new Date(b.startAt).toISOString(), hours: Number(b.hours), started } })}>
                        <MoveRight aria-hidden /> {started ? "Change end" : "Move"}
                      </Button>
                      {b.isTentative ? (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            className="bg-white"
                            disabled={pending}
                            onClick={() =>
                              start(async () => {
                                const until = dayPlus(today, options.holdDays);
                                const r = await extendHoldAction(b.id, until);
                                if (!r.ok) return void toast.error(r.message);
                                toast.success(`Hold extended to ${formatDate(until)}`);
                                after();
                              })
                            }
                          >
                            Extend hold
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={pending}
                            onClick={async () => {
                              if (!(await confirm({ title: "Release this hold?", description: "The machine time is freed for other jobs. The job goes back to To plan if nothing else covers it.", confirmLabel: "Release", destructive: true }))) return;
                              start(async () => {
                                const r = await cancelBookingAction(b.id, true);
                                if (!r.ok) return void toast.error(r.message);
                                toast.success("Hold released");
                                after();
                              });
                            }}
                          >
                            Release
                          </Button>
                        </>
                      ) : !started ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label="Remove booking"
                          disabled={pending}
                          onClick={async () => {
                            if (!(await confirm({ title: "Remove this booking?", description: `${b.machine}, ${formatWhen(new Date(b.startAt))}. The time is freed for other jobs.`, confirmLabel: "Remove", destructive: true }))) return;
                            start(async () => {
                              const r = await cancelBookingAction(b.id);
                              if (!r.ok) return void toast.error(r.message);
                              toast.success("Booking removed");
                              after();
                            });
                          }}
                        >
                          <Trash2 aria-hidden /> Remove
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </Section>

      <Section title="Work" icon={<History className="size-4" />}>
        {d.timeLogs.length ? (
          <ul className="mb-2 flex flex-col gap-1 text-sm">
            {d.timeLogs.map((l) => (
              <li key={l.id}>
                {formatWhen(new Date(l.startedAt))} to {l.endedAt ? formatWhen(new Date(l.endedAt)) : "now (running)"}
                {l.operator ? ` · ${l.operator}` : ""}
                {l.pauseReason ? <span className="text-muted-foreground"> · paused: {l.pauseReason}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Not started yet. Operators start and finish jobs from the Today page.</p>
        )}
        <p className="text-sm">
          Actual hours: <strong>{formatHours(d.actualHours)}</strong>
          {quoted != null ? (
            <span className={cn(overPct != null && overPct > 0 ? "text-red-800" : "text-muted-foreground")}>
              {" "}
              · Quoted {formatHours(quoted)}
              {d.actualHours > 0 ? `, took ${formatHours(d.actualHours)} (${overPct! >= 0 ? "+" : ""}${Math.round(overPct! * 10) / 10}%)` : ""}
            </span>
          ) : null}
        </p>
        {j.doneNote ? <p className="mt-1 text-sm">Done: {j.doneNote}</p> : null}
      </Section>

      <Section
        title="Materials used"
        icon={<PackageMinus className="size-4" />}
        action={
          j.status !== "CANCELLED" && (can("inventory.use") || can("inventory.use_own_jobs", { dept: d.ticket.deptCode })) ? (
            <Button asChild size="sm" variant="outline">
              <Link href={`/inventory/movements/new?type=out&ticket=${d.ticket.id}`}>Record materials</Link>
            </Button>
          ) : null
        }
      >
        {materials?.items.length ? (
          <>
            <ul className="text-sm">
              {materials.items.map((m) => (
                <li key={m.itemId} className="flex justify-between gap-3">
                  <span>{m.name}</span>
                  <span className="text-muted-foreground tabular-nums">{formatINR(m.valuePaise)}</span>
                </li>
              ))}
            </ul>
            {kept ? (
              <p className="mt-2 text-sm">
                Kept after materials: <strong>{formatINR(kept.keptPaise)}</strong>
                {kept.pct != null ? ` (${kept.pct.toFixed(1)}%)` : ""}
              </p>
            ) : null}
          </>
        ) : (
          materials?.noneNeeded ? (
            <p className="text-sm">
              Kept after materials: <strong>{formatINR(materials.taxablePaise)}</strong> (100%, no materials)
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">{materials?.hasList ? "Not recorded yet." : "No materials recorded for this job."}</p>
          )
        )}
      </Section>

      <Section title="Attachments" icon={<Paperclip className="size-4" />}>
        {d.files.length ? (
          <ul className="mb-3 flex flex-col gap-1 text-sm">
            {d.files.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-2">
                <a href={`/api/files/${f.id}`} target="_blank" rel="noopener" className="flex items-center gap-1.5 text-primary hover:underline">
                  <FileText className="size-4" aria-hidden /> {f.file_name}
                </a>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Remove ${f.file_name}`}
                  onClick={() =>
                    start(async () => {
                      const r = await removeJobFileAction(j.id, f.id);
                      if (!r.ok) return void toast.error(r.message);
                      after();
                    })
                  }
                >
                  <X aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        <FileField
          id={`job-file-${j.id}`}
          kind="JOB"
          env={env}
          value={file}
          onChange={(f) => {
            setFile(f);
            if (!f) return;
            start(async () => {
              const r = await addJobFileAction(j.id, f.id);
              if (!r.ok) return void toast.error(r.message);
              toast.success(`${r.data.fileName} attached`);
              setFile(null);
              after();
            });
          }}
        />
        <p className="mt-1 text-xs text-muted-foreground">Drawings or a test plan (PDF, JPG or PNG).</p>
      </Section>

      <Section title="Links" icon={<ExternalLink className="size-4" />}>
        <div className="flex flex-wrap gap-2 text-sm">
          <Link href={`/orders?ticket=${d.ticket.id}`} className="rounded-full border px-3 py-1 hover:bg-secondary">
            Ticket {d.ticket.ticketNo}
          </Link>
          <Link href={`/quotations/${d.ticket.quotationId}`} className="rounded-full border px-3 py-1 hover:bg-secondary">
            Quotation {d.ticket.quoteNo}
          </Link>
          <Link href={`/customers/${d.ticket.customerId}`} className="rounded-full border px-3 py-1 hover:bg-secondary">
            {d.ticket.company}
          </Link>
        </div>
      </Section>

      <Section title="History" icon={<History className="size-4" />}>
        <ol className="flex flex-col gap-2 text-sm">
          {d.events.map((e) => (
            <li key={e.id}>
              <span className="text-xs text-muted-foreground">
                {formatWhen(new Date(e.createdAt))}
                {e.created_by ? ` · ${e.created_by}` : ""}
              </span>
              <span className="block">{e.message}</span>
            </li>
          ))}
        </ol>
        {late ? (
          <p className="mt-3 flex items-center gap-2 text-sm text-red-800">
            <AlertTriangle className="size-4" aria-hidden /> Past its promised date.
          </p>
        ) : null}
      </Section>

      {booking ? (
        <BookTimeDialog
          open
          onOpenChange={(o) => !o && setBooking(null)}
          job={bookJob}
          options={options}
          move={booking.move}
          pickAnother={booking.pickAnother}
          onDone={reload}
        />
      ) : null}
      {dialog}
    </>
  );
}
