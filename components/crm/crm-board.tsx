"use client";

import { DndContext, DragOverlay, PointerSensor, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { ChevronsLeftRight, Handshake, MoreHorizontal, Plus, SearchX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { usePatches } from "./use-patches";
import { toast } from "sonner";
import { useConfirm } from "@/components/common/confirm";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { deleteLeadsAction, moveLeadAction, restoreLeadsAction, setLeadPriorityAction, setStageFoldedAction } from "@/lib/actions/crm";
import type { BoardLead, BoardStage, CrmPickers } from "@/lib/crm-data";
import { matchesFilters, sortLeads, todayInIndia } from "@/lib/crm/leads";
import { stageColor } from "@/lib/crm/stages";
import { formatINRShort } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import { CrmToolbar } from "./crm-toolbar";
import { LeadCard, type LeadCardHandlers } from "./lead-card";
import { LostDialog } from "./lost-dialog";
import { QuickAdd } from "./quick-add";
import { useCrmFilters } from "./use-crm-filters";

export function CrmBoard({ stages, leads, pickers }: { stages: BoardStage[]; leads: BoardLead[]; pickers: CrmPickers }) {
  const router = useRouter();
  const { filters, sort, params, set } = useCrmFilters();
  const today = todayInIndia();
  const [pending, startTransition] = useTransition();
  const [dialog, confirm] = useConfirm();

  // Optimistic changes, cleared whenever fresh data arrives from the server.
  const [local, patchLead] = usePatches<Partial<BoardLead>>(leads);
  const [foldPatch, patchFold] = usePatches<{ folded: boolean }>(stages);
  const all = useMemo(() => leads.map((l) => (local[l.id] ? { ...l, ...local[l.id] } : l)), [leads, local]);
  const visible = useMemo(() => sortLeads(all.filter((l) => matchesFilters(l, filters, today)), sort), [all, filters, sort, today]);
  const inStage = (id: string) => visible.filter((l) => l.stageId === id);
  const stageById = (id: string) => stages.find((s) => s.id === id)!;
  const isFolded = (s: BoardStage) => foldPatch[s.id]?.folded ?? s.isFolded;

  // ---- moving cards ---------------------------------------------------------------
  const [lost, setLost] = useState<{ lead: BoardLead; stageId: string } | null>(null);

  const doMove = (l: BoardLead, stageId: string, lostInfo?: { reasonId: string; note: string }) =>
    startTransition(async () => {
      patchLead(l.id, { stageId, stageChangedAt: new Date().toISOString() });
      const r = await moveLeadAction(l.id, stageId, lostInfo);
      if (!r.ok) {
        patchLead(l.id, { stageId: l.stageId, stageChangedAt: l.stageChangedAt });
        return void toast.error(r.message);
      }
      setLost(null);
      router.refresh();
      const d = r.data;
      if (d.toType === "WON") {
        toast.success(`${l.title} is won`);
        if (!d.customerId) void askConvert(d.leadId, d.companyName);
      } else if (d.toType === "LOST") toast.success(`${l.title} marked as lost`);
      else if (d.fromType !== "OPEN") toast.success(`${l.title} reopened in ${d.toName}`);
      else toast.success(`Moved to ${d.toName}`);
    });

  // Asked after the move has saved (outside the save, so the board isn't kept busy).
  const askConvert = async (leadId: string, company: string) => {
    const yes = await confirm({
      title: `Make ${company} a customer now?`,
      description: "You'll get the customer form with the enquiry's details filled in. Add the address, GST and PAN, then save.",
      confirmLabel: "Yes, convert",
      cancelLabel: "Later",
    });
    if (yes) router.push(`/customers/new?lead=${leadId}`);
  };

  const moveTo = (l: BoardLead, stageId: string) => {
    if (stageId === l.stageId) return;
    if (stageById(stageId).type === "LOST") return setLost({ lead: l, stageId });
    doMove(l, stageId);
  };

  const handlers: LeadCardHandlers = {
    onMoveTo: moveTo,
    onPriority: (l, v) =>
      startTransition(async () => {
        patchLead(l.id, { priority: v });
        const r = await setLeadPriorityAction(l.id, v);
        if (!r.ok) {
          patchLead(l.id, { priority: l.priority });
          toast.error(r.message);
        }
      }),
    onDelete: async (l) => {
      if (!(await confirm({ title: `Delete “${l.title}”?`, description: "It is removed from the board and the list. You can undo this straight after.", confirmLabel: "Delete", destructive: true }))) return;
      const r = await deleteLeadsAction([l.id]);
      if (!r.ok) return void toast.error(r.message);
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
    },
  };

  // ---- quick add -------------------------------------------------------------------
  const firstOpen = stages.find((s) => s.type === "OPEN")!;
  // "New enquiry" from the list view lands here with ?new=1.
  const [quickAdd, setQuickAdd] = useState<string | null>(() => (params.get("new") === "1" ? firstOpen.id : null));
  const [tab, setTab] = useState<string>(filters.stage ?? firstOpen.id);
  const startQuickAdd = (stageId: string) => {
    patchFold(stageId, { folded: false });
    setTab(stageId);
    setQuickAdd(stageId);
  };

  useEffect(() => {
    if (params.get("new") === "1") set({ new: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fold = (s: BoardStage, v: boolean) => {
    patchFold(s.id, { folded: v });
    startTransition(async () => {
      const r = await setStageFoldedAction(s.id, v);
      if (!r.ok) {
        patchFold(s.id, { folded: !v });
        return void toast.error(r.message);
      }
      router.refresh();
    });
  };

  // ---- drag and drop -----------------------------------------------------------------
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const [dragging, setDragging] = useState<BoardLead | null>(null);
  const onDragStart = (e: DragStartEvent) => setDragging((e.active.data.current?.lead as BoardLead) ?? null);
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    const l = e.active.data.current?.lead as BoardLead | undefined;
    const to = e.over?.id as string | undefined;
    if (l && to) moveTo(l, to);
  };

  const quickAddFor = (s: BoardStage) =>
    quickAdd === s.id ? (
      <QuickAdd
        stageId={s.id}
        sources={pickers.sources}
        onCancel={() => setQuickAdd(null)}
        onDone={() => {
          setQuickAdd(null);
          router.refresh();
        }}
      />
    ) : null;

  const cards = (s: BoardStage, draggable: boolean) =>
    inStage(s.id).map((l) => <LeadCard key={l.id} lead={l} stage={stageById(l.stageId)} stages={stages} today={today} handlers={handlers} draggable={draggable} />);

  const total = (id: string) => inStage(id).reduce((a, l) => a + (l.expectedValuePaise ?? 0), 0);
  const nothingAtAll = leads.length === 0;
  const nothingMatches = !nothingAtAll && visible.length === 0;

  return (
    <>
      {dialog}
      <CrmToolbar view="board" pickers={pickers} onNew={() => startQuickAdd(firstOpen.id)} />

      {nothingAtAll && !quickAdd ? (
        <EmptyState
          icon={Handshake}
          title="No enquiries yet"
          description="Add each phone call, walk-in, website or event enquiry as a card, then move it along as you follow up."
          action={
            <Button onClick={() => startQuickAdd(firstOpen.id)}>
              <Plus aria-hidden /> Add the first enquiry
            </Button>
          }
        />
      ) : (
        <>
          {nothingMatches ? (
            <p className="mb-4 flex items-center gap-2 rounded-xl border border-dashed p-4 text-muted-foreground">
              <SearchX className="size-5" aria-hidden /> No enquiries match these filters.
            </p>
          ) : null}

          {/* Phone and tablet: stages as tabs */}
          <div className="lg:hidden">
            <div role="tablist" aria-label="Stages" className="mb-4 grid grid-cols-[repeat(auto-fit,minmax(5.5rem,1fr))] gap-1 rounded-xl bg-secondary p-1">
              {stages.map((s) => (
                <button
                  key={s.id}
                  role="tab"
                  type="button"
                  aria-selected={tab === s.id}
                  onClick={() => setTab(s.id)}
                  className={cn(
                    "flex min-h-14 min-w-0 flex-col items-center justify-center rounded-lg px-1 text-xs font-medium leading-tight",
                    tab === s.id ? "bg-card text-primary shadow-sm" : "text-muted-foreground",
                  )}
                >
                  <span className="flex max-w-full items-center gap-1">
                    <span className={cn("size-2 rounded-full", stageColor(s.color).dot)} aria-hidden />
                    <span className="truncate">{s.name}</span>
                  </span>
                  <span className="text-base font-semibold tabular-nums">{inStage(s.id).length}</span>
                </button>
              ))}
            </div>
            {stages
              .filter((s) => s.id === tab)
              .map((s) => (
                <div key={s.id}>
                  <ColumnHeader stage={s} count={inStage(s.id).length} totalPaise={total(s.id)} onQuickAdd={() => startQuickAdd(s.id)} />
                  <div role="tabpanel" className="flex flex-col gap-3">
                    {quickAddFor(s)}
                    {cards(s, false)}
                    {!inStage(s.id).length && quickAdd !== s.id ? <p className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">No enquiries in this stage.</p> : null}
                  </div>
                </div>
              ))}
          </div>

          {/* Desktop: drag and drop board */}
          <DndContext id="crm-board" sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
            <div className="hidden gap-3 overflow-x-auto pb-3 lg:flex" aria-busy={pending}>
              {stages.map((s) =>
                isFolded(s) ? (
                  <FoldedColumn key={s.id} stage={s} count={inStage(s.id).length} onUnfold={() => fold(s, false)} dragging={!!dragging} />
                ) : (
                  <Column key={s.id} stage={s} dragging={dragging}>
                    <ColumnHeader stage={s} count={inStage(s.id).length} totalPaise={total(s.id)} onQuickAdd={() => startQuickAdd(s.id)} onFold={() => fold(s, true)} />
                    <div className="flex flex-1 flex-col gap-3">
                      {quickAddFor(s)}
                      {cards(s, true)}
                      {!inStage(s.id).length && quickAdd !== s.id ? <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">No enquiries here.</p> : null}
                    </div>
                  </Column>
                ),
              )}
            </div>
            <DragOverlay dropAnimation={null}>
              {dragging ? <LeadCard lead={dragging} stage={stageById(dragging.stageId)} stages={stages} today={today} handlers={handlers} overlay /> : null}
            </DragOverlay>
          </DndContext>
        </>
      )}

      <LostDialog
        open={!!lost}
        title={`Mark “${lost?.lead.title ?? ""}” as lost?`}
        reasons={pickers.lostReasons}
        pending={pending}
        onCancel={() => setLost(null)}
        onConfirm={(v) => lost && doMove(lost.lead, lost.stageId, v)}
      />
    </>
  );
}

function ColumnHeader({
  stage,
  count,
  totalPaise,
  onQuickAdd,
  onFold,
}: {
  stage: BoardStage;
  count: number;
  totalPaise: number;
  onQuickAdd: () => void;
  onFold?: () => void;
}) {
  return (
    <header className="mb-3">
      <div className={cn("mb-2 h-1.5 rounded-full", stageColor(stage.color).bar)} aria-hidden />
      <div className="flex items-center justify-between gap-1">
        <h2 className="min-w-0 truncate text-base font-semibold text-primary">
          {stage.name} <span className="font-normal text-muted-foreground">({count})</span>
        </h2>
        <span className="flex shrink-0 items-center">
          <Button variant="ghost" size="icon-sm" className="size-8" aria-label={`Quick add to ${stage.name}`} title="Quick add" onClick={onQuickAdd}>
            <Plus aria-hidden />
          </Button>
          {onFold ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" className="size-8" aria-label={`More for the ${stage.name} column`}>
                  <MoreHorizontal aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem className="h-10" onSelect={onFold}>
                  <ChevronsLeftRight /> Fold column
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </span>
      </div>
      <p className="text-sm font-semibold text-foreground tabular-nums" title="Total expected value">
        {formatINRShort(totalPaise)} <span className="text-xs font-normal text-muted-foreground">expected</span>
      </p>
    </header>
  );
}

function Column({ stage, dragging, children }: { stage: BoardStage; dragging: BoardLead | null; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const isHome = dragging?.stageId === stage.id;
  return (
    <section
      ref={setNodeRef}
      aria-label={stage.name}
      className={cn(
        "flex min-h-[60vh] min-w-48 flex-1 basis-0 flex-col rounded-2xl border bg-secondary/50 p-2.5 transition-colors",
        dragging && !isHome && "border-primary/40 bg-sky-50",
        isOver && !isHome && (stage.type === "LOST" ? "border-red-400 bg-red-50" : "border-primary bg-sky-100"),
      )}
    >
      {children}
    </section>
  );
}

/** A folded column: a thin strip with the name and count. Click to unfold. */
function FoldedColumn({ stage, count, onUnfold, dragging }: { stage: BoardStage; count: number; onUnfold: () => void; dragging: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onUnfold}
      aria-label={`${stage.name}, ${count} ${count === 1 ? "enquiry" : "enquiries"}. Folded, click to unfold.`}
      title="Click to unfold"
      className={cn(
        "flex min-h-[60vh] w-12 shrink-0 flex-col items-center gap-3 rounded-2xl border bg-secondary/50 py-3 hover:border-primary/40",
        dragging && "border-primary/40 bg-sky-50",
        isOver && "border-primary bg-sky-100",
      )}
    >
      <span className={cn("h-6 w-1.5 rounded-full", stageColor(stage.color).bar)} aria-hidden />
      <span className="rounded-full bg-card px-1.5 text-sm font-semibold tabular-nums">{count}</span>
      <span className="text-sm font-semibold text-primary [writing-mode:vertical-rl]">{stage.name}</span>
    </button>
  );
}
