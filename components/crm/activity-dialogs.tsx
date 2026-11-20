"use client";

import { CalendarClock, Check, CheckCheck, Loader2, Mail, MapPin, MessageCircle, Phone, RotateCw, Users } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Field } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { markActivityDoneAction, planActivityAction } from "@/lib/actions/crm";
import { ACTIVITY_TYPES, type ActivityType } from "@/lib/crm/leads";
import { addDays, todayInIndia } from "@/lib/tickets";
import { cn } from "@/lib/utils";

export const ACTIVITY_ICONS: Record<ActivityType, React.ComponentType<{ className?: string }>> = {
  CALL: Phone,
  MEETING: Users,
  EMAIL: Mail,
  WHATSAPP: MessageCircle,
  SITE_VISIT: MapPin,
  FOLLOW_UP: RotateCw,
};

export type PlanFor = { leadId: string; title: string; assignedTo: string | null };

/** "Plan activity": type, due date (required), time, note, assigned to (defaults to the enquiry's owner). */
export function PlanActivityDialog({
  plan,
  team,
  onClose,
  onDone,
}: {
  plan: PlanFor | null;
  team: { id: string; name: string }[];
  onClose: () => void;
  onDone: () => void;
}) {
  return (
    <Dialog open={!!plan} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">{plan ? <PlanBody key={plan.leadId} plan={plan} team={team} onClose={onClose} onDone={onDone} /> : null}</DialogContent>
    </Dialog>
  );
}

function PlanBody({ plan, team, onClose, onDone }: { plan: PlanFor; team: { id: string; name: string }[]; onClose: () => void; onDone: () => void }) {
  const today = todayInIndia();
  const [type, setType] = useState<ActivityType>("CALL");
  const [dueDate, setDueDate] = useState(addDays(today, 1));
  const [dueTime, setDueTime] = useState("");
  const [note, setNote] = useState("");
  const [assignedTo, setAssignedTo] = useState(plan.assignedTo ?? "");
  const [pending, start] = useTransition();
  const [touched, setTouched] = useState(false);
  const dateError = !dueDate ? "Please choose the due date." : dueDate < today ? "The due date can't be in the past." : undefined;

  const quick = [
    { label: "Today", v: today },
    { label: "Tomorrow", v: addDays(today, 1) },
    { label: "In 3 days", v: addDays(today, 3) },
    { label: "Next week", v: addDays(today, 7) },
  ];

  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (dateError) return;
        start(async () => {
          const r = await planActivityAction({ leadId: plan.leadId, type, dueDate, dueTime: dueTime || null, note: note || null, assignedTo: assignedTo || null });
          if (!r.ok) return void toast.error(r.message);
          toast.success(`${ACTIVITY_TYPES[type]} planned`);
          onDone();
        });
      }}
    >
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <CalendarClock className="size-5" aria-hidden /> Plan activity
        </DialogTitle>
        <DialogDescription>For “{plan.title}”</DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-1.5">
        <span className="text-base font-medium">
          Type <span className="text-destructive">*</span>
        </span>
        <div role="radiogroup" aria-label="Type" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {(Object.keys(ACTIVITY_TYPES) as ActivityType[]).map((t) => {
            const Icon = ACTIVITY_ICONS[t];
            const on = type === t;
            return (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setType(t)}
                className={cn("flex h-11 items-center gap-2 rounded-xl border px-3 text-sm font-medium", on ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-primary/40")}
              >
                <Icon className="size-4" aria-hidden /> {ACTIVITY_TYPES[t]}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Field label="Due date" required error={touched ? dateError : undefined}>
            {(p) => <Input {...p} type="date" min={today} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />}
          </Field>
          <div role="group" aria-label="Quick dates" className="flex flex-wrap gap-1.5">
            {quick.map((q) => (
              <button
                key={q.label}
                type="button"
                aria-pressed={dueDate === q.v}
                onClick={() => setDueDate(q.v)}
                className={cn("h-8 rounded-full border px-2.5 text-xs font-medium", dueDate === q.v ? "border-primary bg-primary/10 text-primary" : "bg-card hover:border-primary/40")}
              >
                {q.label}
              </button>
            ))}
          </div>
        </div>
        <Field label="Time" optional helper="e.g. 10:30 am">
          {(p) => <Input {...p} type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />}
        </Field>
      </div>

      <Field label="Note" optional helper="e.g. Ask for the drawings and quantity">
        {(p) => <Textarea {...p} rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />}
      </Field>
      <Field label="Assigned to" optional>
        {(p) => (
          <Select value={assignedTo || "none"} onValueChange={(v) => setAssignedTo(v === "none" ? "" : v)}>
            <SelectTrigger {...p} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Not assigned</SelectItem>
              {team.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <CalendarClock aria-hidden />} Plan activity
        </Button>
      </DialogFooter>
    </form>
  );
}

export type DoneFor = { id: string; type: ActivityType; leadId: string; title: string; assignedTo: string | null };

/** "Mark done": asks for an outcome. "Done, plan next" then opens a new Plan activity form. */
export function DoneActivityDialog({ activity, onClose, onDone }: { activity: DoneFor | null; onClose: () => void; onDone: (planNext: boolean) => void }) {
  return (
    <Dialog open={!!activity} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>{activity ? <DoneBody key={activity.id} activity={activity} onClose={onClose} onDone={onDone} /> : null}</DialogContent>
    </Dialog>
  );
}

function DoneBody({ activity, onClose, onDone }: { activity: DoneFor; onClose: () => void; onDone: (planNext: boolean) => void }) {
  const [outcome, setOutcome] = useState("");
  const [touched, setTouched] = useState(false);
  const [pending, start] = useTransition();
  const error = outcome.trim().length < 2 ? "Please write a short outcome." : undefined;
  const save = (planNext: boolean) => {
    setTouched(true);
    if (error) return;
    start(async () => {
      const r = await markActivityDoneAction(activity.id, outcome);
      if (!r.ok) return void toast.error(r.message);
      toast.success(`${ACTIVITY_TYPES[activity.type]} marked as done`);
      onDone(planNext);
    });
  };
  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        save(false);
      }}
    >
      <DialogHeader>
        <DialogTitle>Mark {ACTIVITY_TYPES[activity.type].toLowerCase()} as done</DialogTitle>
        <DialogDescription>For “{activity.title}”. What happened?</DialogDescription>
      </DialogHeader>
      <Field label="Outcome" required helper="e.g. Spoke to Neha, she will send the drawings on Monday" error={touched ? error : undefined}>
        {(p) => <Textarea {...p} rows={3} value={outcome} onChange={(e) => setOutcome(e.target.value)} maxLength={1000} autoFocus />}
      </Field>
      <DialogFooter className="gap-2 sm:gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" variant="outline" disabled={pending} onClick={() => save(true)}>
          <CheckCheck aria-hidden /> Done, plan next
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />} Done
        </Button>
      </DialogFooter>
    </form>
  );
}
