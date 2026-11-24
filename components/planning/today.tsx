"use client";

import { AlertTriangle, CheckCircle2, Hand, Loader2, MessageCircle, PackageMinus, Pause, Play, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, useTransition } from "react";
import { toast } from "sonner";
import { useConfirm } from "@/components/common/confirm";
import { useCan, useMe } from "@/components/auth/permissions-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { finishJobAction, handOverAction, pauseJobAction, readySentAction, startJobAction, type NeedMachine } from "@/lib/actions/work";
import { Checkbox } from "@/components/ui/checkbox";
import type { TodayCard, TodayData } from "@/lib/planning-data";
import { formatHours, formatWhen, hhmm, istDate, istMinutes } from "@/lib/planning/hours";
import { JOB_STATUS_UI } from "@/lib/planning/job-status";
import { fillReadyTemplate } from "@/lib/planning/templates";
import { PAUSE_REASONS, sinceText } from "@/lib/planning/work";
import { whatsappNumber } from "@/lib/reminders";
import { cn } from "@/lib/utils";

const KEY = "planning-operator";
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  window.addEventListener("storage", fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", fn);
  };
};
const read = () => {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
};
const write = (v: string) => {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* private mode: just not remembered */
  }
  listeners.forEach((fn) => fn());
};

const time = (iso: string) => hhmm(Math.round(istMinutes(new Date(iso))));
const when = (c: TodayCard, today: string) => {
  if (!c.start || !c.end) return "Not booked";
  const s = new Date(c.start);
  const e = new Date(c.end);
  const sameDay = istDate(s) === today && istDate(e) === today;
  return sameDay ? `${time(c.start)} to ${time(c.end)}` : `${formatWhen(s)} to ${formatWhen(e)}`;
};

type DoneFlow = { card: TodayCard; step: "form" | "materials" | "ready" };

/** "Today" for operators: their jobs, with big Start / Pause / Resume / Done buttons. */
export function TodayBoard({ data }: { data: TodayData }) {
  const can = useCan();
  const router = useRouter();
  const self = useMe();
  const stored = useSyncExternalStore(subscribe, read, () => "");
  // Everyone works as themselves. Managers and Admins can look at someone else's day (or everyone's).
  const mineId = self.teamMemberId && data.team.some((t) => t.id === self.teamMemberId) ? self.teamMemberId : "";
  const me = !self.mayRecordForOthers ? (self.teamMemberId ?? "") : stored === "all" ? "" : data.team.some((t) => t.id === stored) ? stored : mineId;
  const [dialog, confirm] = useConfirm();
  const [pending, start] = useTransition();
  const [pauseFor, setPauseFor] = useState<TodayCard | null>(null);
  const [done, setDone] = useState<DoneFlow | null>(null);
  const [handFor, setHandFor] = useState<TodayCard | null>(null);
  const [askMachine, setAskMachine] = useState<{ card: TodayCard; info: NeedMachine; more: { pauseOther?: boolean } } | null>(null);

  const mine = data.cards.filter((c) => !me || c.operatorIds.includes(me));
  const unassigned = me ? data.cards.filter((c) => !c.operatorIds.length && ["PLANNED", "TO_PLAN"].includes(c.status)) : [];
  const running = mine.filter((c) => c.status === "RUNNING");
  const todays = mine.filter((c) => ["PLANNED", "TO_PLAN"].includes(c.status) && c.start);
  const onHold = mine.filter((c) => c.status === "ON_HOLD");
  const finished = mine.filter((c) => c.status === "DONE");

  type More = { pauseOther?: boolean; machineId?: string | null; removeLaterBookingId?: string | null };
  const doStart = (c: TodayCard, more: More = {}) =>
    start(async () => {
      const r = await startJobAction(c.jobId, me || null, more);
      if (!r.ok) {
        if (r.otherRunning && (await confirm({ title: "Another job is running", description: r.message, confirmLabel: `Pause ${r.otherRunning} and start` }))) return void doStart(c, { ...more, pauseOther: true });
        if (r.needMachine) return void setAskMachine({ card: c, info: r.needMachine, more });
        return void toast.error(r.message);
      }
      toast.success(`${c.ticketNo} ${c.status === "ON_HOLD" ? "resumed" : "started"}${r.data.machine ? ` on ${r.data.machine}` : ""}`);
      router.refresh();
    });

  const Section = ({ title, list, empty }: { title: string; list: TodayCard[]; empty?: string }) =>
    list.length || empty ? (
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">
          {title} {list.length ? <span className="text-sm font-normal text-muted-foreground">({list.length})</span> : null}
        </h2>
        {list.length ? list.map((c) => <Card key={c.jobId} c={c} />) : <p className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">{empty}</p>}
      </section>
    ) : null;

  const Card = ({ c }: { c: TodayCard }) => {
    const st = JOB_STATUS_UI[c.status];
    return (
      <article className={cn("rounded-2xl border bg-card p-4", c.status === "RUNNING" && "border-emerald-400 ring-1 ring-emerald-200", c.overrun && "border-red-400 ring-red-200")}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium text-muted-foreground">{c.machine ?? "No machine booked"}</p>
            <p className="text-lg font-semibold">{c.company}</p>
            <p>{c.service}</p>
          </div>
          <span className={cn("rounded-full border px-2.5 py-0.5 text-xs font-medium", st.className)}>{st.label}</span>
        </div>
        <p className="mt-2 text-sm">
          <Link href={`/planning/today?job=${c.jobId}`} scroll={false} className="font-medium text-primary tabular-nums underline-offset-4 hover:underline">
            {c.ticketNo}
          </Link>{" "}
          · {when(c, data.today)}
          {c.actualHours > 0 ? ` · worked ${formatHours(c.actualHours)}` : ""}
        </p>
        {c.instructions ? <p className="mt-2 rounded-xl bg-secondary px-3 py-2 text-sm whitespace-pre-line">{c.instructions}</p> : null}
        {c.status === "ON_HOLD" && c.holdReason ? <p className="mt-2 text-sm text-orange-800">On hold: {c.holdReason}</p> : null}
        {c.overrun && c.firstStarted ? (
          <p className="mt-2 flex items-center gap-2 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-900">
            <AlertTriangle className="size-4 shrink-0" aria-hidden /> Still running? Started {sinceText(new Date(c.firstStarted))} ago.
          </p>
        ) : null}
        {c.status === "DONE" && c.doneNote ? <p className="mt-2 text-sm text-muted-foreground">Done: {c.doneNote}</p> : null}
        {/* Start / Pause / Done need "planning.operate" for the job's department (the server checks again). */}
        {can("planning.operate", { dept: c.deptCode }) ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {c.status === "PLANNED" || c.status === "TO_PLAN" ? (
            <Button size="lg" className="col-span-2 h-14 text-base" disabled={pending} onClick={() => doStart(c)}>
              <Play aria-hidden /> Start
            </Button>
          ) : null}
          {c.status === "RUNNING" ? (
            <>
              <Button size="lg" variant="outline" className="h-14 text-base" disabled={pending} onClick={() => setPauseFor(c)}>
                <Pause aria-hidden /> Pause
              </Button>
              <Button size="lg" className="h-14 text-base" disabled={pending} onClick={() => setDone({ card: c, step: "form" })}>
                <CheckCircle2 aria-hidden /> Done
              </Button>
            </>
          ) : null}
          {c.status === "ON_HOLD" ? (
            <>
              <Button size="lg" className="h-14 text-base" disabled={pending} onClick={() => doStart(c)}>
                <Play aria-hidden /> Resume
              </Button>
              <Button size="lg" variant="outline" className="h-14 text-base" disabled={pending} onClick={() => setDone({ card: c, step: "form" })}>
                <CheckCircle2 aria-hidden /> Done
              </Button>
            </>
          ) : null}
          {c.status === "DONE" ? (
            <>
              <Button size="lg" variant="outline" className="h-14 text-base" onClick={() => setHandFor(c)}>
                <Hand aria-hidden /> Handed over
              </Button>
              <Button size="lg" variant="outline" className="h-14 text-base" onClick={() => setDone({ card: c, step: "ready" })}>
                <MessageCircle aria-hidden /> Tell the customer
              </Button>
            </>
          ) : null}
        </div>
        ) : null}
      </article>
    );
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      {!self.mayRecordForOthers ? (
        <p className="flex items-center gap-2 rounded-2xl border bg-card p-4 font-semibold">
          <UserRound className="size-5 text-primary" aria-hidden /> Your jobs, {self.name ?? "you"}
        </p>
      ) : (
      <div className="flex flex-col gap-2 rounded-2xl border bg-card p-4">
        <label htmlFor="who" className="flex items-center gap-2 font-semibold">
          <UserRound className="size-5 text-primary" aria-hidden /> Who&apos;s working?
        </label>
        <Select value={me || "all"} onValueChange={(v) => write(v)}>
          <SelectTrigger id="who" className="h-12 w-full text-base">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Everyone (show all jobs)</SelectItem>
            {data.team.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">Remembered on this phone. Work you start, pause or finish here is recorded for this person, and the history says you recorded it.</p>
      </div>
      )}

      <Section title="Running" list={running} />
      <Section title="Today" list={todays} empty={running.length ? undefined : "Nothing booked for you today."} />
      <Section title="On hold" list={onHold} />
      {unassigned.length ? <Section title="Today, no operator chosen" list={unassigned.filter((c) => c.start)} /> : null}
      <Section title="Done, not handed over yet" list={finished} />

      <PauseDialog card={pauseFor} onClose={() => setPauseFor(null)} operatorId={me || null} />
      {done ? <DoneDialog flow={done} setFlow={setDone} operatorId={me || null} template={data.readyTemplate} orgName={data.orgName} /> : null}
      <HandOverDialog card={handFor} onClose={() => setHandFor(null)} today={data.today} />
      {askMachine ? (
        <MachineDialog
          ask={askMachine}
          onClose={() => setAskMachine(null)}
          onStart={(machineId, removeLater) => {
            const { card, more } = askMachine;
            setAskMachine(null);
            doStart(card, { ...more, machineId, removeLaterBookingId: removeLater });
          }}
        />
      ) : null}
      {dialog}
    </div>
  );
}

/** Start with no booking covering now: "Which machine are you using?" (+ remove the later booking?). */
function MachineDialog({ ask, onClose, onStart }: { ask: { card: TodayCard; info: NeedMachine }; onClose: () => void; onStart: (machineId: string, removeLaterBookingId: string | null) => void }) {
  const { card, info } = ask;
  const [machine, setMachine] = useState(info.suggestedMachineId ?? "");
  const [removeLater, setRemoveLater] = useState(true);
  const suitable = info.machines.filter((m) => m.suitable);
  const others = info.machines.filter((m) => !m.suitable);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Which machine are you using?</DialogTitle>
          <DialogDescription>
            {card.ticketNo} isn&apos;t booked for now. A booking starting now is made for the time still needed ({formatHours(info.hours)}).
          </DialogDescription>
        </DialogHeader>
        <Select value={machine} onValueChange={setMachine}>
          <SelectTrigger className="h-12 w-full text-base" aria-label="Machine">
            <SelectValue placeholder="Choose the machine" />
          </SelectTrigger>
          <SelectContent>
            {suitable.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
            {others.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.deptCode} · {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {info.later ? (
          <label className="flex min-h-12 items-start gap-3 rounded-xl border p-3 text-sm">
            <Checkbox checked={removeLater} onCheckedChange={(v) => setRemoveLater(v === true)} className="mt-0.5" />
            <span>
              Remove the later booking on {info.later.machine}, {formatWhen(new Date(info.later.start))}? The work is happening now.
            </span>
          </label>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!machine} onClick={() => onStart(machine, info.later && removeLater ? info.later.bookingId : null)}>
            <Play aria-hidden /> Start
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PauseDialog({ card, onClose, operatorId }: { card: TodayCard | null; onClose: () => void; operatorId: string | null }) {
  const router = useRouter();
  const [reason, setReason] = useState<string>("");
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  return (
    <Dialog open={!!card} onOpenChange={(o) => !o && (onClose(), setReason(""), setNote(""))}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pause {card?.ticketNo}?</DialogTitle>
          <DialogDescription>Why is it paused? The time while paused isn&apos;t counted.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2" role="radiogroup" aria-label="Reason">
          {PAUSE_REASONS.map((r) => (
            <button key={r} type="button" role="radio" aria-checked={reason === r} onClick={() => setReason(r)} className={cn("min-h-12 rounded-xl border px-4 text-left font-medium", reason === r ? "border-primary bg-primary text-primary-foreground" : "hover:bg-secondary")}>
              {r}
            </button>
          ))}
        </div>
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={reason === "Other" ? "Please write the reason" : "Note (optional)"} maxLength={500} aria-label="Note" />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={pending || !reason || (reason === "Other" && note.trim().length < 3)}
            onClick={() =>
              start(async () => {
                const r = await pauseJobAction(card!.jobId, reason, note || null, operatorId);
                if (!r.ok) return void toast.error(r.message);
                toast.success(`${card!.ticketNo} paused`);
                onClose();
                setReason("");
                setNote("");
                router.refresh();
              })
            }
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Pause aria-hidden />} Pause
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Done: completion note -> "Record materials now?" (if needed) -> "Tell the customer it's ready". */
function DoneDialog({ flow, setFlow, operatorId, template, orgName }: { flow: DoneFlow; setFlow: (f: DoneFlow | null) => void; operatorId: string | null; template: string; orgName: string }) {
  const router = useRouter();
  const c = flow.card;
  const [note, setNote] = useState("");
  const [qty, setQty] = useState("");
  const [problems, setProblems] = useState("");
  const [pending, start] = useTransition();
  const close = () => setFlow(null);
  const wa = c.phone ? whatsappNumber(c.phone) : null;
  const message = fillReadyTemplate(template, { contact_name: c.contact ?? "Sir / Madam", company: c.company, job_no: c.ticketNo, service: c.service, org_name: orgName });
  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto">
        {flow.step === "form" ? (
          <>
            <DialogHeader>
              <DialogTitle>Mark {c.ticketNo} done?</DialogTitle>
              <DialogDescription>
                {c.company} · {c.service}
              </DialogDescription>
            </DialogHeader>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Completion note (required)
              <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. All parts printed, cleaned and checked" maxLength={2000} autoFocus />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Quantity done (optional)
              <Input value={qty} onChange={(e) => setQty(e.target.value)} placeholder="e.g. 18 of 20 parts" maxLength={200} />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Any problems (optional)
              <Textarea rows={2} value={problems} onChange={(e) => setProblems(e.target.value)} placeholder="e.g. 2 parts warped, reprint needed" maxLength={2000} />
            </label>
            <DialogFooter>
              <Button variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button
                disabled={pending || note.trim().length < 3}
                onClick={() =>
                  start(async () => {
                    const r = await finishJobAction(c.jobId, { note, qtyDone: qty || null, problems: problems || null }, operatorId);
                    if (!r.ok) return void toast.error(r.message);
                    toast.success(`${c.ticketNo} done`);
                    router.refresh();
                    setFlow({ card: c, step: c.materialsMissing ? "materials" : "ready" });
                  })
                }
              >
                {pending ? <Loader2 className="animate-spin" aria-hidden /> : <CheckCircle2 aria-hidden />} Mark done
              </Button>
            </DialogFooter>
          </>
        ) : flow.step === "materials" ? (
          <>
            <DialogHeader>
              <DialogTitle>Record materials now?</DialogTitle>
              <DialogDescription>No materials are recorded for {c.ticketNo} yet. The usual quantities are filled in for you.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setFlow({ card: c, step: "ready" })}>
                Not now
              </Button>
              <Button asChild>
                <Link href={`/inventory/movements/new?type=out&ticket=${c.ticketId}`}>
                  <PackageMinus aria-hidden /> Record materials
                </Link>
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Tell the customer it&apos;s ready?</DialogTitle>
              <DialogDescription>
                {c.contact ? `${c.contact}, ${c.company}` : c.company}
                {wa ? "" : ". No mobile number saved for this customer."}
              </DialogDescription>
            </DialogHeader>
            <pre className="max-h-56 overflow-y-auto rounded-xl border bg-secondary/50 p-3 font-sans text-sm whitespace-pre-wrap">{message}</pre>
            <DialogFooter>
              <Button variant="outline" onClick={close}>
                Not now
              </Button>
              <Button
                disabled={!wa}
                onClick={() => {
                  const a = document.createElement("a");
                  a.href = `https://wa.me/${wa}?text=${encodeURIComponent(message)}`;
                  a.target = "_blank";
                  a.rel = "noopener";
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                  void readySentAction(c.jobId, c.phone).then((r) => r.ok && toast.success("Noted in the job's history"));
                  close();
                }}
              >
                <MessageCircle aria-hidden /> Open WhatsApp
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function HandOverDialog({ card, onClose, today }: { card: TodayCard | null; onClose: () => void; today: string }) {
  const router = useRouter();
  const [date, setDate] = useState(today);
  const [to, setTo] = useState("");
  const [pending, start] = useTransition();
  return (
    <Dialog open={!!card} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Handed over: {card?.ticketNo}</DialogTitle>
          <DialogDescription>Parts or samples given back to the customer.</DialogDescription>
        </DialogHeader>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Date
          <Input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} className="h-11" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Received by
          <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder={card?.contact ? `e.g. ${card.contact}` : "Name"} maxLength={200} className="h-11" />
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={pending || to.trim().length < 2}
            onClick={() =>
              start(async () => {
                const r = await handOverAction(card!.jobId, date, to);
                if (!r.ok) return void toast.error(r.message);
                toast.success(`${card!.ticketNo} handed over`);
                setTo("");
                onClose();
                router.refresh();
              })
            }
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Hand aria-hidden />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
