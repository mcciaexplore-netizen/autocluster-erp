"use client";

import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Info, Loader2, Lock, Plus, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { addStageAction, renameStageAction, reorderStagesAction, setStageProbabilityAction } from "@/lib/actions/crm";
import type { BoardStage } from "@/lib/crm-data";
import { STAGE_RULES_HELP, stageNameProblem, stageOrderProblem } from "@/lib/crm/stages";
import { cn } from "@/lib/utils";
import { ColorSwatches, type useStageActions } from "./stage-actions";

type Actions = ReturnType<typeof useStageActions>["actions"];

const TYPE_LABEL = { OPEN: "Open", WON: "Won", LOST: "Lost" } as const;

/** "Edit stages" (gear on the board): reorder by dragging, rename, recolour, probability, fold, add, delete. */
export function StageEditor({
  open,
  onOpenChange,
  stages,
  counts,
  actions,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  stages: BoardStage[];
  counts: Record<string, number>;
  actions: Actions;
  onChanged: () => void;
}) {
  const [pending, start] = useTransition();
  // Optimistic order while a drag is saving; dropped when fresh stages arrive.
  const [order, setOrder] = useState<{ for: BoardStage[]; ids: string[] } | null>(null);
  const ids = order?.for === stages ? order.ids : stages.map((s) => s.id);
  const list = ids.map((id) => stages.find((s) => s.id === id)!).filter(Boolean);
  const [newName, setNewName] = useState("");

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const next = arrayMove(list, list.findIndex((s) => s.id === e.active.id), list.findIndex((s) => s.id === e.over!.id));
    const problem = stageOrderProblem(next);
    if (problem) return void toast.error(problem);
    setOrder({ for: stages, ids: next.map((s) => s.id) });
    start(async () => {
      const r = await reorderStagesAction(next.map((s) => s.id));
      if (!r.ok) {
        setOrder(null);
        return void toast.error(r.message);
      }
      toast.success("Order saved");
      onChanged();
    });
  };

  const add = (ev: React.FormEvent) => {
    ev.preventDefault();
    const problem = stageNameProblem(newName, stages);
    if (problem) return void toast.error(problem);
    start(async () => {
      const r = await addStageAction(newName);
      if (!r.ok) return void toast.error(r.message);
      toast.success(`Added “${r.data.name}” before Won`);
      setNewName("");
      onChanged();
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="gap-0 overflow-y-auto p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
        <SheetHeader className="border-b p-5 pr-12">
          <SheetTitle className="text-xl">Edit stages</SheetTitle>
          <SheetDescription>Changes apply for everyone straight away.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 p-5" aria-busy={pending || actions.pending}>
          <p className="flex gap-2 rounded-xl bg-secondary p-3 text-sm">
            <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <span>
              Drag <GripVertical className="inline size-4 align-text-bottom" aria-label="the handle" /> to reorder. {STAGE_RULES_HELP}
            </span>
          </p>

          <DndContext id="stage-editor" sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={ids} strategy={verticalListSortingStrategy}>
              <ul className="flex flex-col gap-2">
                {list.map((s) => (
                  <StageRow key={s.id} stage={s} count={counts[s.id] ?? 0} stages={stages} actions={actions} onChanged={onChanged} />
                ))}
              </ul>
            </SortableContext>
          </DndContext>

          <form onSubmit={add} className="flex flex-col gap-2 rounded-xl border border-dashed p-3 sm:flex-row">
            <Input aria-label="New stage name" placeholder="New stage, e.g. Site visit" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={40} className="min-w-0 flex-1" />
            <Button type="submit" disabled={pending || !newName.trim()}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />} Add stage
            </Button>
          </form>
          <p className="text-sm text-muted-foreground">New stages are open stages, added just before Won.</p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function StageRow({ stage: s, count, stages, actions, onChanged }: { stage: BoardStage; count: number; stages: BoardStage[]; actions: Actions; onChanged: () => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: s.id });
  const [pending, start] = useTransition();
  const [name, setName] = useState(s.name);
  const [prob, setProb] = useState(String(s.probability));
  // Show fresh values after someone else changes them (unless being edited).
  const [seen, setSeen] = useState({ name: s.name, prob: s.probability });
  if (seen.name !== s.name || seen.prob !== s.probability) {
    setSeen({ name: s.name, prob: s.probability });
    setName(s.name);
    setProb(String(s.probability));
  }
  const closed = s.type !== "OPEN";

  const saveName = () => {
    if (name.trim() === s.name) return setName(s.name);
    const problem = stageNameProblem(name, stages.filter((x) => x.id !== s.id));
    if (problem) {
      toast.error(problem);
      return setName(s.name);
    }
    start(async () => {
      const r = await renameStageAction(s.id, name);
      if (!r.ok) {
        setName(s.name);
        return void toast.error(r.message);
      }
      toast.success(`Renamed to “${name.trim()}”`);
      onChanged();
    });
  };
  const saveProb = () => {
    const n = Number(prob);
    if (prob.trim() === String(s.probability)) return;
    if (!/^\d{1,3}$/.test(prob.trim()) || n > 100) {
      toast.error("Probability must be a whole number from 0 to 100.");
      return setProb(String(s.probability));
    }
    start(async () => {
      const r = await setStageProbabilityAction(s.id, n);
      if (!r.ok) {
        setProb(String(s.probability));
        return void toast.error(r.message);
      }
      onChanged();
    });
  };

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("flex flex-col gap-3 rounded-xl border bg-card p-3", isDragging && "relative z-10 shadow-lg ring-2 ring-primary/30")}
      aria-busy={pending}
    >
      <div className="flex items-center gap-2">
        <button
          ref={setActivatorNodeRef}
          type="button"
          className="grid size-9 shrink-0 cursor-grab touch-none place-items-center rounded-lg text-muted-foreground hover:bg-secondary active:cursor-grabbing"
          aria-label={`Drag to reorder ${s.name}`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-5" aria-hidden />
        </button>
        <Input
          aria-label={`Name of the ${s.name} stage`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
            if (e.key === "Escape") setName(s.name);
          }}
          maxLength={40}
          className="h-10 min-w-0 flex-1 font-medium"
        />
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
            s.type === "WON" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : s.type === "LOST" ? "border-red-200 bg-red-50 text-red-700" : "bg-secondary text-muted-foreground",
          )}
          title={closed ? "Can't be deleted or changed to another type" : undefined}
        >
          {closed ? <Lock className="size-3" aria-hidden /> : null}
          {TYPE_LABEL[s.type]}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 pl-11">
        <ColorSwatches label={`Colour of the ${s.name} stage`} value={s.color} onChange={(c) => actions.color(s, c)} disabled={actions.pending} />
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Probability</span>
          <span className="flex items-center rounded-lg border bg-card focus-within:ring-2 focus-within:ring-ring">
            <Input
              aria-label={`Probability of the ${s.name} stage (%)`}
              inputMode="numeric"
              value={prob}
              onChange={(e) => setProb(e.target.value)}
              onBlur={saveProb}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              className="h-9 w-14 border-0 text-right shadow-none focus-visible:ring-0"
              maxLength={3}
            />
            <span className="pr-2 text-muted-foreground">%</span>
          </span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={s.isFolded} onCheckedChange={(v) => actions.fold(s, v)} aria-label={`Fold the ${s.name} column on the board`} />
          <span className="text-muted-foreground">Folded on the board</span>
        </label>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {count} {count === 1 ? "enquiry" : "enquiries"}
          </span>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            className="text-destructive hover:text-destructive disabled:text-muted-foreground"
            disabled={closed}
            title={closed ? `The ${TYPE_LABEL[s.type]} stage can't be deleted` : `Delete ${s.name}`}
            aria-label={closed ? `The ${TYPE_LABEL[s.type]} stage can't be deleted` : `Delete the ${s.name} stage`}
            onClick={() => actions.remove(s)}
          >
            <Trash2 aria-hidden />
          </Button>
        </div>
      </div>
    </li>
  );
}
