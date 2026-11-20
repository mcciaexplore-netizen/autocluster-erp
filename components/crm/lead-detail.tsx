"use client";

import {
  ArrowLeftRight,
  Building2,
  Check,
  CircleDot,
  FileText,
  Loader2,
  Mail,
  MessageCircle,
  MoreHorizontal,
  NotebookPen,
  Pencil,
  Phone,
  PencilLine,
  RotateCcw,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Trophy,
  XCircle,
  Plus,
  CalendarClock,
  CalendarX,
  CheckCheck,
  X,
} from "lucide-react";
import { timeLabel } from "@/lib/crm/time";
import { ACTIVITY_TYPES, activityDueLabel, activityStatus, todayInIndia } from "@/lib/crm/leads";
import { ACTIVITY_ICONS } from "./activity-dialogs";
import { useActivityFlow } from "./use-activity-flow";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { StatusChip } from "@/components/common/badges";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { addLeadNoteAction, cancelActivityAction, deleteLeadsAction, logLeadContactAction, restoreLeadsAction, setLeadPriorityAction } from "@/lib/actions/crm";
import type { LeadDetail } from "@/lib/crm-data";
import { stageColor } from "@/lib/crm/stages";
import { formatDate } from "@/lib/format";
import { CATEGORY_LABELS, formatINRShort } from "@/lib/pricing";
import { STAGE_INFO } from "@/lib/tickets";
import { cn } from "@/lib/utils";
import { Initials, PriorityStars, StagePill } from "./lead-bits";
import { useLeadMove } from "./use-lead-move";

type StageLite = { id: string; name: string; color: string; type: "OPEN" | "WON" | "LOST" };

const ACT_ROW = { overdue: "border-red-200 bg-red-50/60", today: "border-amber-300 bg-amber-50/60", planned: "border-emerald-200 bg-emerald-50/40", none: "" } as const;
const ACT_ICON = { overdue: "border-red-200 text-red-700", today: "border-amber-300 text-amber-700", planned: "border-emerald-200 text-emerald-700", none: "" } as const;
const ACT_TEXT = { overdue: "font-semibold text-red-700", today: "font-semibold text-amber-700", planned: "text-emerald-700", none: "" } as const;

const dateTime = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

const EVENT_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  CREATED: Plus,
  STAGE: ArrowLeftRight,
  WON: Trophy,
  LOST: XCircle,
  REOPENED: RotateCcw,
  FIELD: PencilLine,
  EDITED: Pencil,
  NOTE: NotebookPen,
  CONTACT_CALL: Phone,
  CONTACT_WHATSAPP: MessageCircle,
  CONTACT_EMAIL: Mail,
  ACTIVITY_PLANNED: CalendarClock,
  ACTIVITY_DONE: CheckCheck,
  ACTIVITY_CANCELLED: CalendarX,
  DELETED: Trash2,
  RESTORED: RotateCcw,
};

export function LeadDetailView({
  detail,
  stages,
  lostReasons,
  team,
  onChanged,
  onEdit,
  onDeleted,
}: {
  detail: LeadDetail;
  stages: StageLite[];
  lostReasons: { id: string; name: string }[];
  team: { id: string; name: string }[];
  /** Called after anything is saved, so the view reloads. */
  onChanged: () => void;
  onEdit: () => void;
  onDeleted: () => void;
}) {
  const router = useRouter();
  const { lead: l } = detail;
  const stage = stages.find((s) => s.id === l.stageId);
  const mover = useLeadMove({ stages, lostReasons, onMoved: onChanged });
  const [pending, start] = useTransition();
  const [note, setNote] = useState("");
  const [priority, setPriority] = useState<{ for: string; v: number } | null>(null);
  const shownPriority = priority?.for === `${l.id}:${l.priority}` ? priority.v : l.priority;

  const contact = (kind: "CALL" | "WHATSAPP" | "EMAIL") => {
    // Log the click without holding up the link.
    void logLeadContactAction(l.id, kind).then((r) => (r.ok ? onChanged() : toast.error(r.message)));
  };

  const saveNote = () =>
    start(async () => {
      const r = await addLeadNoteAction(l.id, note);
      if (!r.ok) return void toast.error(r.message);
      setNote("");
      toast.success("Note added");
      onChanged();
    });

  const remove = async () => {
    if (!(await mover.confirm({ title: `Delete “${l.title}”?`, description: "It is removed from the board and the list. You can undo this straight after.", confirmLabel: "Delete", destructive: true }))) return;
    const r = await deleteLeadsAction([l.id]);
    if (!r.ok) return void toast.error(r.message);
    onDeleted();
    router.refresh();
    toast.success("Enquiry deleted", {
      action: {
        label: "Undo",
        onClick: async () => {
          const u = await restoreLeadsAction([l.id]);
          if (!u.ok) return void toast.error(u.message);
          router.refresh();
          toast.success("Enquiry restored");
        },
      },
    });
  };

  const movable = { id: l.id, title: l.title, stageId: l.stageId };
  const today = todayInIndia();
  const flow = useActivityFlow({ team, onChanged });
  const planned = detail.activities.filter((a) => !a.doneAt);
  const cancelPlanned = async (a: (typeof planned)[number]) => {
    if (!(await mover.confirm({ title: `Cancel this ${ACTIVITY_TYPES[a.type].toLowerCase()}?`, description: `Planned for ${formatDate(a.dueDate)}. This is noted in the history.`, confirmLabel: "Cancel activity", cancelLabel: "Keep it", destructive: true }))) return;
    const r = await cancelActivityAction(a.id);
    if (!r.ok) return void toast.error(r.message);
    toast.success("Activity cancelled");
    onChanged();
  };
  const isOpen = stage?.type === "OPEN";

  return (
    <div className="flex flex-col gap-5">
      {mover.elements}
      {flow.elements}

      {/* Header */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span className="tabular-nums">{l.leadNo}</span>
          {stage ? <StagePill name={stage.name} color={stage.color} /> : null}
          <span>· {l.sourceName}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div>
            <p className="text-xs text-muted-foreground">Expected value</p>
            <p className="text-xl font-semibold text-primary tabular-nums">{l.expectedValuePaise != null ? formatINRShort(l.expectedValuePaise) : "Not set"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Priority</p>
            <PriorityStars
              value={shownPriority}
              onChange={(v) =>
                start(async () => {
                  setPriority({ for: `${l.id}:${l.priority}`, v });
                  const r = await setLeadPriorityAction(l.id, v);
                  if (!r.ok) {
                    setPriority(null);
                    return void toast.error(r.message);
                  }
                  router.refresh();
                })
              }
            />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Assigned to</p>
            <p className="flex items-center gap-2 font-medium">
              {l.assignedToName ? (
                <>
                  <Initials name={l.assignedToName} /> {l.assignedToName}
                </>
              ) : (
                <span className="text-muted-foreground">Not assigned</span>
              )}
            </p>
          </div>
          {l.expectedCloseDate ? (
            <div>
              <p className="text-xs text-muted-foreground">Expected close</p>
              <p className="font-medium">{formatDate(l.expectedCloseDate)}</p>
            </div>
          ) : null}
        </div>
        {stage?.type === "LOST" ? (
          <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <strong>Lost:</strong> {l.lostReason ?? "No reason given"}
            {l.lostNote ? ` · ${l.lostNote}` : ""}
            {l.lostAt ? ` · ${formatDate(new Date(l.lostAt))}` : ""}
          </p>
        ) : stage?.type === "WON" ? (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            <strong>Won</strong>
            {l.wonAt ? ` on ${formatDate(new Date(l.wonAt))}` : ""}
          </p>
        ) : null}
      </section>

      {/* Stage bar (Odoo style): click a stage to move the enquiry there */}
      <nav aria-label="Stage" className="flex flex-wrap gap-1">
        {stages.map((s) => {
          const on = s.id === l.stageId;
          return (
            <button
              key={s.id}
              type="button"
              aria-current={on ? "step" : undefined}
              disabled={mover.pending}
              onClick={() => mover.moveTo(movable, s.id)}
              className={cn(
                "inline-flex h-9 min-w-0 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition",
                on ? cn(stageColor(s.color).pill, "border-2 font-semibold") : "bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
              )}
            >
              <span className={cn("size-2 shrink-0 rounded-full", stageColor(s.color).dot)} aria-hidden />
              {s.name}
              {on ? <Check className="size-3.5" aria-hidden /> : null}
            </button>
          );
        })}
      </nav>

      {/* Buttons */}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => flow.openPlan({ leadId: l.id, title: l.title, assignedTo: l.assignedTo })}>
          <CalendarClock aria-hidden /> Plan activity
        </Button>
        {isOpen ? (
          <>
            <Button size="sm" className="bg-emerald-700 text-white hover:bg-emerald-800" onClick={() => mover.markWon(movable)} disabled={mover.pending}>
              <ThumbsUp aria-hidden /> Mark as won
            </Button>
            <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => mover.markLost(movable)} disabled={mover.pending}>
              <ThumbsDown aria-hidden /> Mark as lost
            </Button>
          </>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" aria-label="More actions">
              <MoreHorizontal aria-hidden /> More
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            <DropdownMenuItem className="h-10" onSelect={onEdit}>
              <Pencil /> Edit
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="h-10 text-destructive focus:text-destructive" onSelect={remove}>
              <Trash2 /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Company and quick contact */}
      <section className="rounded-xl border p-4">
        <h3 className="mb-2 flex items-center gap-2 font-semibold text-primary">
          <Building2 className="size-4" aria-hidden /> {l.companyName}
        </h3>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Contact</dt>
          <dd>
            {l.contactName}
            {l.designation ? <span className="text-muted-foreground">, {l.designation}</span> : null}
          </dd>
          {l.phone ? (
            <>
              <dt className="text-muted-foreground">Mobile</dt>
              <dd className="tabular-nums">+91 {l.phone}</dd>
            </>
          ) : null}
          {l.email ? (
            <>
              <dt className="text-muted-foreground">Email</dt>
              <dd className="break-all">{l.email}</dd>
            </>
          ) : null}
          {l.city ? (
            <>
              <dt className="text-muted-foreground">City</dt>
              <dd>{l.city}</dd>
            </>
          ) : null}
          {l.category ? (
            <>
              <dt className="text-muted-foreground">Category</dt>
              <dd>{CATEGORY_LABELS[l.category]}</dd>
            </>
          ) : null}
          {l.isMcciaMember != null ? (
            <>
              <dt className="text-muted-foreground">MCCIA member</dt>
              <dd>{l.isMcciaMember ? `Yes${l.mcciaMembershipId ? ` (${l.mcciaMembershipId})` : ""}` : "No"}</dd>
            </>
          ) : null}
        </dl>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <ContactButton href={detail.contact.telUrl} icon={Phone} label="Call" missing="No mobile number" onClick={() => contact("CALL")} />
          <ContactButton href={detail.contact.whatsappUrl} icon={MessageCircle} label="WhatsApp" missing="No mobile number" onClick={() => contact("WHATSAPP")} external />
          <ContactButton href={detail.contact.mailtoUrl} icon={Mail} label="Email" missing="No email address" onClick={() => contact("EMAIL")} />
        </div>
      </section>

      {/* Activities: planned first; done ones move into the history */}
      <section className="rounded-xl border p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="font-semibold text-primary">Planned activities</h3>
          <Button size="sm" variant="ghost" onClick={() => flow.openPlan({ leadId: l.id, title: l.title, assignedTo: l.assignedTo })}>
            <Plus aria-hidden /> Plan
          </Button>
        </div>
        {planned.length ? (
          <ul className="flex flex-col gap-2">
            {planned.map((a) => {
              const st = activityStatus(a.dueDate, today);
              const Icon = ACTIVITY_ICONS[a.type];
              return (
                <li key={a.id} className={cn("flex flex-wrap items-start gap-3 rounded-lg border p-3", ACT_ROW[st])}>
                  <span className={cn("grid size-9 shrink-0 place-items-center rounded-full border bg-card", ACT_ICON[st])}>
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {ACTIVITY_TYPES[a.type]} <span className={cn("text-sm", ACT_TEXT[st])}>· {activityDueLabel(a.dueDate, today)}</span>
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {formatDate(a.dueDate)}
                      {a.dueTime ? `, ${timeLabel(a.dueTime)}` : ""}
                      {a.assignedToName ? ` · ${a.assignedToName}` : ""}
                    </p>
                    {a.note ? <p className="mt-1 text-sm">{a.note}</p> : null}
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" className="bg-card" onClick={() => flow.openDone({ id: a.id, type: a.type, leadId: l.id, title: l.title, assignedTo: a.assignedTo })}>
                      <Check aria-hidden /> Mark done
                    </Button>
                    <Button size="icon-sm" variant="ghost" aria-label={`Cancel ${ACTIVITY_TYPES[a.type].toLowerCase()} on ${formatDate(a.dueDate)}`} onClick={() => cancelPlanned(a)}>
                      <X aria-hidden />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Nothing planned. Plan the next call, meeting or follow-up so it isn&apos;t forgotten.</p>
        )}
      </section>

      {/* What they're interested in */}
      {detail.deptCodes.length || detail.services.length || detail.tags.length || l.notes ? (
        <section className="rounded-xl border p-4 text-sm">
          {detail.deptCodes.length ? (
            <p className="mb-2 flex flex-wrap items-center gap-1.5">
              <span className="text-muted-foreground">Departments:</span>
              {detail.deptCodes.map((d) => (
                <span key={d} className="rounded-full border bg-secondary px-2 py-0.5 text-xs font-medium text-primary">
                  {d}
                </span>
              ))}
            </p>
          ) : null}
          {detail.services.length ? (
            <p className="mb-2">
              <span className="text-muted-foreground">Services: </span>
              {detail.services.map((s) => s.name).join(", ")}
            </p>
          ) : null}
          {detail.tags.length ? (
            <p className="mb-2 flex flex-wrap items-center gap-1.5">
              <span className="text-muted-foreground">Tags:</span>
              {detail.tags.map((t) => (
                <span key={t.id} className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-800">
                  {t.name}
                </span>
              ))}
            </p>
          ) : null}
          {l.notes ? <p className="whitespace-pre-wrap">{l.notes}</p> : null}
        </section>
      ) : null}

      {/* Linked records */}
      <section className="rounded-xl border p-4">
        <h3 className="mb-2 font-semibold text-primary">Linked records</h3>
        <p className="text-sm">
          <span className="text-muted-foreground">Customer: </span>
          {detail.customer ? (
            <Link href={`/customers/${detail.customer.id}`} className="font-medium text-primary hover:underline">
              {detail.customer.companyName}
            </Link>
          ) : (
            <span className="text-muted-foreground">Not a customer yet</span>
          )}
        </p>
        {detail.quotations.length ? (
          <ul className="mt-3 flex flex-col gap-2">
            {detail.quotations.map((q) => (
              <li key={q.id} className="rounded-lg border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link href={`/quotations/${q.id}`} className="flex items-center gap-1.5 font-medium text-primary hover:underline">
                    <FileText className="size-4" aria-hidden /> {q.quoteNo}
                  </Link>
                  <span className="flex items-center gap-2">
                    <StatusChip status={q.status} />
                    <span className="font-semibold tabular-nums">{formatINRShort(q.totalPaise)}</span>
                  </span>
                </div>
                {q.tickets.length ? (
                  <ul className="mt-2 flex flex-col gap-0.5 text-muted-foreground">
                    {q.tickets.map((t) => (
                      <li key={t.ticketNo} className="flex items-center gap-1.5">
                        <CircleDot className="size-3" aria-hidden />
                        <span className="tabular-nums">{t.ticketNo}</span> {t.description}: <span className="font-medium text-foreground">{STAGE_INFO[t.stage as keyof typeof STAGE_INFO]?.title ?? t.stage}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">No quotations from this enquiry yet.</p>
        )}
      </section>

      {/* History */}
      <section>
        <h3 className="mb-2 font-semibold text-primary">History</h3>
        <div className="mb-4 flex flex-col gap-2 rounded-xl border p-3">
          <label htmlFor={`note-${l.id}`} className="text-sm font-medium">
            Log a note
          </label>
          <Textarea id={`note-${l.id}`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Spoke to Neha, drawings coming on Monday" maxLength={3000} />
          <div className="flex justify-end">
            <Button size="sm" onClick={saveNote} disabled={pending || note.trim().length < 2}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : <NotebookPen aria-hidden />} Add note
            </Button>
          </div>
        </div>
        <ol className="flex flex-col">
          {detail.events.map((e) => {
            const Icon = EVENT_ICONS[e.type] ?? CircleDot;
            return (
              <li key={e.id} className="flex gap-3 border-l-2 border-border pb-4 pl-4 last:pb-0">
                <span className="-ml-[1.6rem] grid size-6 shrink-0 place-items-center rounded-full border bg-card">
                  <Icon className="size-3.5 text-primary" />
                </span>
                <div className="min-w-0">
                  <p className={cn("text-sm", e.type === "NOTE" && "whitespace-pre-wrap")}>{e.type === "NOTE" ? <span className="font-medium">Note: </span> : null}{e.message}</p>
                  <p className="text-xs text-muted-foreground">
                    {dateTime.format(new Date(e.createdAt))} · {e.createdBy}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}

function ContactButton({
  href,
  icon: Icon,
  label,
  missing,
  onClick,
  external,
}: {
  href: string | null;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  missing: string;
  onClick: () => void;
  external?: boolean;
}) {
  if (!href)
    return (
      <Button variant="outline" size="sm" disabled title={missing} aria-label={`${label}: ${missing}`}>
        <Icon className="size-4" aria-hidden /> {label}
      </Button>
    );
  return (
    <Button asChild variant="outline" size="sm">
      <a href={href} onClick={onClick} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>
        <Icon className="size-4" aria-hidden /> {label}
      </a>
    </Button>
  );
}
