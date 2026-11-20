"use client";

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Search, SquareKanban, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/empty-state";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cancelTicketAction, moveTicketBackAction } from "@/lib/actions/orders";
import type { BlobEnv } from "@/lib/files";
import type { BoardTicket } from "@/lib/orders-data";
import { formatINR } from "@/lib/pricing";
import { daysBetween, followUpDue, moveKind, moveProblem, STAGE_INFO, STAGES, todayInIndia, type BoardStage } from "@/lib/tickets";
import { cn } from "@/lib/utils";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { BoardForms } from "./forms";
import { ReasonDialog } from "./reason-dialog";
import { TicketCard } from "./ticket-card";
import { TicketPanel } from "./ticket-panel";
import type { ActionKind } from "./types";

export interface BoardCustomer {
  id: string;
  name: string;
}

const DEPTS = ["RPT", "PPF", "ENV", "RPL"];

function useFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };
  return { params, set };
}

export function OrdersBoard({ tickets, customers, uploadEnv }: { tickets: BoardTicket[]; customers: BoardCustomer[]; uploadEnv: BlobEnv }) {
  const router = useRouter();
  const { params, set } = useFilters();
  const today = todayInIndia();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [pending, startTransition] = useTransition();
  useAutoRefresh("orders");

  // ---- filters ---------------------------------------------------------------
  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get("q") ?? "") !== q.trim()) set({ q: q.trim() || null });
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const f = {
    q: (params.get("q") ?? "").trim().toLowerCase(),
    dept: params.get("dept"),
    customer: params.get("customer"),
    overdue: params.get("overdue") === "1",
    followup: params.get("followup") === "1",
    cancelled: params.get("cancelled") === "1",
    stage: params.get("stage") as BoardStage | null,
  };
  const anyFilter = !!(f.q || f.dept || f.customer || f.overdue || f.followup || f.cancelled || f.stage);

  const visible = useMemo(
    () =>
      tickets.filter((t) => {
        if (f.cancelled ? t.stage !== "CANCELLED" : t.stage === "CANCELLED") return false;
        if (f.dept && t.deptCode !== f.dept) return false;
        if (f.customer && t.customerId !== f.customer) return false;
        if (f.stage && t.stage !== f.stage) return false;
        if (f.overdue && !(t.stage === "PAYMENT" && t.invoice && t.invoice.leftPaise > 0 && daysBetween(today, t.invoice.dueDate) < 0)) return false;
        if (f.followup && !(t.stage === "PAYMENT" && t.invoice && followUpDue(t.invoice, today))) return false;
        if (f.q) {
          const hay = [t.ticketNo, t.quoteNo, t.companyName, t.po?.number, t.invoice?.number, t.description].join(" ").toLowerCase();
          if (!hay.includes(f.q)) return false;
        }
        return true;
      }),
    [tickets, f.cancelled, f.dept, f.customer, f.stage, f.overdue, f.followup, f.q, today],
  );
  const byStage = (s: BoardStage) => visible.filter((t) => t.stage === s);

  // ---- selected ticket (detail panel) ------------------------------------------
  const selectedId = params.get("ticket");
  const selected = tickets.find((t) => t.id === selectedId) ?? null;
  const refreshKey = useMemo(() => tickets.map((t) => `${t.id}:${t.stage}:${t.invoice?.leftPaise ?? ""}`).join("|"), [tickets]);

  // ---- actions -------------------------------------------------------------------
  const [action, setAction] = useState<{ kind: ActionKind; ticket: BoardTicket } | null>(null);
  const openAction = (kind: ActionKind, ticket: BoardTicket) => {
    if (kind === "view") return set({ ticket: ticket.id });
    setAction({ kind, ticket });
  };
  const closeAction = () => setAction(null);
  const done = () => {
    setAction(null);
    router.refresh();
  };

  const moveTo = (t: BoardTicket, to: BoardStage) => {
    const problem = moveProblem(t.stage, to);
    if (problem) return void toast.error(problem);
    const kind = moveKind(t.stage, to);
    if (kind === "back") return setAction({ kind: "moveBack", ticket: t });
    if (kind === "forward") {
      // Moving forward needs the form for that step; the card moves only once it is saved.
      setAction({ kind: to === "BILLING" ? "addPo" : to === "PAYMENT" ? "invoice" : "payment", ticket: t });
    }
  };

  // ---- drag and drop --------------------------------------------------------------
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const [dragging, setDragging] = useState<BoardTicket | null>(null);
  const onDragStart = (e: DragStartEvent) => setDragging((e.active.data.current?.ticket as BoardTicket) ?? null);
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    const t = e.active.data.current?.ticket as BoardTicket | undefined;
    const to = e.over?.id as BoardStage | undefined;
    if (!t || !to || to === t.stage) return;
    moveTo(t, to);
  };

  // ---- phone tabs -------------------------------------------------------------------
  const [tab, setTab] = useState<BoardStage>(f.stage ?? "WAITING_PO");

  // Payment follow-up shows what is still to collect (each invoice counted once); other columns show the services' value.
  const columnTotal = (s: BoardStage) => {
    if (s !== "PAYMENT") return byStage(s).reduce((sum, t) => sum + t.totalPaise, 0);
    const left = new Map<string, number>();
    for (const t of byStage(s)) if (t.invoice) left.set(t.invoice.id, t.invoice.leftPaise);
    return [...left.values()].reduce((a, b) => a + b, 0);
  };

  return (
    <>
      {/* Filters */}
      <div className="mb-5 flex flex-col gap-3">
        <div className="relative">
          <label htmlFor="board-search" className="sr-only">
            Search tickets
          </label>
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            id="board-search"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by ticket, quotation, company, PO no. or invoice no."
            className="h-12 pl-11"
          />
        </div>
        <div className="flex flex-col gap-3 xl:flex-row xl:flex-wrap xl:items-center">
          <div role="group" aria-label="Department" className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-sm font-medium text-muted-foreground">Department:</span>
            {DEPTS.map((d) => (
              <Chip key={d} active={f.dept === d} onClick={() => set({ dept: f.dept === d ? null : d })}>
                {d}
              </Chip>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="cust-filter" className="text-sm font-medium text-muted-foreground">
              Customer:
            </label>
            <Select value={f.customer ?? "all"} onValueChange={(v) => set({ customer: v === "all" ? null : v })}>
              <SelectTrigger id="cust-filter" size="sm" className="h-10 w-60 max-w-[60vw] text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All customers</SelectItem>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Chip active={f.overdue} onClick={() => set({ overdue: f.overdue ? null : "1", cancelled: null })}>
              Overdue only
            </Chip>
            <Chip active={f.followup} onClick={() => set({ followup: f.followup ? null : "1", cancelled: null })}>
              Follow-up due today
            </Chip>
            <Chip active={f.cancelled} onClick={() => set({ cancelled: f.cancelled ? null : "1", overdue: null, followup: null, stage: null })}>
              Show cancelled
            </Chip>
            {f.stage ? (
              <Chip active onClick={() => set({ stage: null })}>
                Step: {STAGE_INFO[f.stage].title} <X className="size-3.5" aria-hidden />
              </Chip>
            ) : null}
            {anyFilter ? (
              <button
                type="button"
                onClick={() => {
                  setQ("");
                  set({ q: null, dept: null, customer: null, overdue: null, followup: null, cancelled: null, stage: null });
                }}
                className="inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-primary hover:underline"
              >
                <X className="size-4" aria-hidden /> Clear filters
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {f.cancelled ? (
        visible.length ? (
          <div>
            <p className="mb-3 text-sm text-muted-foreground">
              {visible.length} cancelled {visible.length === 1 ? "ticket" : "tickets"}. They are not on the board.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {visible.map((t) => (
                <TicketCard key={t.id} ticket={t} onAction={openAction} onMoveTo={moveTo} draggable={false} />
              ))}
            </div>
          </div>
        ) : (
          <EmptyState icon={SquareKanban} title="No cancelled tickets" />
        )
      ) : !tickets.some((t) => t.stage !== "CANCELLED") ? (
        <EmptyState
          icon={SquareKanban}
          title="Nothing to track yet"
          description="When a quotation is marked Accepted, one ticket per service appears here, ready for its PO."
        />
      ) : (
        <>
          {/* Phone and tablet: tabs */}
          <div className="lg:hidden">
            <div role="tablist" aria-label="Steps" className="mb-4 grid grid-cols-4 gap-1 rounded-xl bg-secondary p-1">
              {STAGES.map((s) => (
                <button
                  key={s}
                  role="tab"
                  type="button"
                  aria-selected={tab === s}
                  onClick={() => setTab(s)}
                  className={cn(
                    "flex min-h-14 min-w-0 flex-col items-center justify-center rounded-lg px-1 text-xs font-medium leading-tight",
                    tab === s ? "bg-card text-primary shadow-sm" : "text-muted-foreground",
                  )}
                >
                  <span className="truncate">{STAGE_INFO[s].short}</span>
                  <span className="text-base font-semibold tabular-nums">{byStage(s).length}</span>
                </button>
              ))}
            </div>
            <ColumnHeader stage={tab} count={byStage(tab).length} totalPaise={columnTotal(tab)} />
            <div role="tabpanel" className="flex flex-col gap-3">
              {byStage(tab).map((t) => (
                <TicketCard key={t.id} ticket={t} onAction={openAction} onMoveTo={moveTo} draggable={false} />
              ))}
              {!byStage(tab).length ? <p className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">No cards in this step.</p> : null}
            </div>
          </div>

          {/* Desktop: drag and drop board */}
          <DndContext id="orders-board" sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
            <div className="hidden gap-4 lg:grid lg:grid-cols-4">
              {STAGES.map((s) => (
                <Column key={s} stage={s} count={byStage(s).length} totalPaise={columnTotal(s)} dragging={dragging}>
                  {byStage(s).map((t) => (
                    <TicketCard key={t.id} ticket={t} onAction={openAction} onMoveTo={moveTo} />
                  ))}
                </Column>
              ))}
            </div>
            <DragOverlay dropAnimation={null}>
              {dragging ? <TicketCard ticket={dragging} onAction={() => {}} onMoveTo={() => {}} overlay /> : null}
            </DragOverlay>
          </DndContext>
        </>
      )}

      <TicketPanel
        ticket={selected}
        open={!!selected}
        onOpenChange={(o) => !o && set({ ticket: null })}
        refreshKey={refreshKey}
      />

      <ReasonDialog
        open={action?.kind === "moveBack"}
        title={`Move ${action?.ticket.ticketNo ?? ""} back?`}
        description={
          action?.ticket.stage === "BILLING"
            ? "It goes back to “Waiting for PO”. The PO stays on record but is unlinked from this service."
            : "It goes back to “Billing”. The invoice stays on record but is unlinked from this service."
        }
        label="Reason"
        helper="e.g. Wrong PO attached"
        confirmLabel="Move back"
        pending={pending}
        onCancel={closeAction}
        onConfirm={(reason) =>
          startTransition(async () => {
            const t = action!.ticket;
            const res = await moveTicketBackAction(t.id, reason);
            if (!res.ok) return void toast.error(res.message);
            toast.success(`${t.ticketNo} moved back`);
            done();
          })
        }
      />
      <ReasonDialog
        open={action?.kind === "cancel"}
        title={`Cancel ${action?.ticket.ticketNo ?? ""}?`}
        description="The ticket leaves the board. You can still find it with “Show cancelled”."
        label="Reason"
        helper="e.g. Customer dropped this service"
        confirmLabel="Cancel ticket"
        destructive
        pending={pending}
        onCancel={closeAction}
        onConfirm={(reason) =>
          startTransition(async () => {
            const t = action!.ticket;
            const res = await cancelTicketAction(t.id, reason);
            if (!res.ok) return void toast.error(res.message);
            toast.success(`${t.ticketNo} cancelled`);
            done();
          })
        }
      />
      <BoardForms action={action} tickets={tickets} uploadEnv={uploadEnv} onClose={closeAction} onDone={done} />
    </>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-10 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition",
        active ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-primary/40",
      )}
    >
      {children}
    </button>
  );
}

function ColumnHeader({ stage, count, totalPaise }: { stage: BoardStage; count: number; totalPaise: number }) {
  return (
    <header className="mb-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-primary">
          {STAGE_INFO[stage].title} <span className="font-normal text-muted-foreground">({count})</span>
        </h2>
        <span className="text-sm font-semibold tabular-nums" title={stage === "PAYMENT" ? "Amount still to collect" : "Value of these services"}>
          {formatINR(totalPaise).replace(/\.00$/, "")}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{STAGE_INFO[stage].help}</p>
    </header>
  );
}

function Column({
  stage,
  count,
  totalPaise,
  dragging,
  children,
}: {
  stage: BoardStage;
  count: number;
  totalPaise: number;
  dragging: BoardTicket | null;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const allowed = dragging ? moveKind(dragging.stage, stage) !== "invalid" : false;
  const isHome = dragging?.stage === stage;
  return (
    <section
      ref={setNodeRef}
      aria-label={STAGE_INFO[stage].title}
      className={cn(
        "flex min-h-[60vh] flex-col rounded-2xl border bg-secondary/50 p-3 transition-colors",
        dragging && !isHome && allowed && "border-primary/40 bg-sky-50",
        dragging && !isHome && !allowed && "opacity-60",
        isOver && allowed && !isHome && "border-primary bg-sky-100",
      )}
    >
      <ColumnHeader stage={stage} count={count} totalPaise={totalPaise} />
      <div className="flex flex-1 flex-col gap-3">
        {children}
        {!count ? <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">No cards here.</p> : null}
      </div>
    </section>
  );
}
