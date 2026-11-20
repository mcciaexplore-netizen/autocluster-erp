"use client";

import { Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Field } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { deleteStageAction, moveStageAction, renameStageAction, setStageColorAction, setStageFoldedAction } from "@/lib/actions/crm";
import type { BoardStage } from "@/lib/crm-data";
import { STAGE_COLOR_KEYS, STAGE_COLORS, stageColor, stageNameProblem, stageOrderProblem, type StageColor } from "@/lib/crm/stages";
import { cn } from "@/lib/utils";

/**
 * Stage actions shared by the "Edit stages" panel and each column's "..." menu.
 * The server enforces the rules; these checks just explain them before asking.
 */
export function useStageActions({ stages, counts, onChanged }: { stages: BoardStage[]; counts: Record<string, number>; onChanged: () => void }) {
  const [pending, start] = useTransition();
  const [renaming, setRenaming] = useState<BoardStage | null>(null);
  const [deleting, setDeleting] = useState<BoardStage | null>(null);

  const save = (fn: () => Promise<{ ok: boolean; message?: string }>, ok?: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.message);
      if (ok) toast.success(ok);
      onChanged();
    });

  const moveProblem = (s: BoardStage, dir: -1 | 1) => {
    const i = stages.findIndex((x) => x.id === s.id);
    const j = i + dir;
    if (j < 0 || j >= stages.length) return "It's already at the end.";
    const ids = [...stages];
    [ids[i], ids[j]] = [ids[j], ids[i]];
    return stageOrderProblem(ids);
  };

  const actions = {
    pending,
    rename: (s: BoardStage) => setRenaming(s),
    remove: (s: BoardStage) => {
      if (s.type !== "OPEN") return void toast.error(`The ${s.type === "WON" ? "Won" : "Lost"} stage can't be deleted. You can rename, recolour or reorder it.`);
      if (stages.filter((x) => x.type === "OPEN").length <= 1) return void toast.error("There must be at least one open stage, so this one can't be deleted.");
      setDeleting(s);
    },
    color: (s: BoardStage, c: StageColor) => save(() => setStageColorAction(s.id, c)),
    fold: (s: BoardStage, v: boolean) => save(() => setStageFoldedAction(s.id, v)),
    canMove: (s: BoardStage, dir: -1 | 1) => !moveProblem(s, dir),
    move: (s: BoardStage, dir: -1 | 1) => {
      const p = moveProblem(s, dir);
      if (p) return void toast.error(p);
      save(() => moveStageAction(s.id, dir));
    },
  };

  const elements = (
    <>
      <RenameStageDialog
        stage={renaming}
        others={stages.filter((s) => s.id !== renaming?.id)}
        pending={pending}
        onClose={() => setRenaming(null)}
        onSave={(name) =>
          start(async () => {
            const r = await renameStageAction(renaming!.id, name);
            if (!r.ok) return void toast.error(r.message);
            toast.success(`Renamed to “${name.trim()}”`);
            setRenaming(null);
            onChanged();
          })
        }
      />
      <DeleteStageDialog
        stage={deleting}
        count={deleting ? (counts[deleting.id] ?? 0) : 0}
        targets={stages.filter((s) => s.type === "OPEN" && s.id !== deleting?.id)}
        pending={pending}
        onClose={() => setDeleting(null)}
        onDelete={(moveTo) =>
          start(async () => {
            const s = deleting!;
            const r = await deleteStageAction(s.id, moveTo);
            if (!r.ok) return void toast.error(r.message);
            const d = r.data;
            toast.success(
              d.moved ? `Deleted “${s.name}”. ${d.moved} ${d.moved === 1 ? "enquiry" : "enquiries"} moved to ${d.to}.` : `Deleted “${s.name}”`,
              d.quoteMoveChangedTo ? { description: `New quotations will now move enquiries to: ${d.quoteMoveChangedTo} (Settings > CRM).` } : undefined,
            );
            setDeleting(null);
            onChanged();
          })
        }
      />
    </>
  );
  return { actions, elements };
}

/** The 8 preset colours as a row of swatches. */
export function ColorSwatches({ value, onChange, label, disabled }: { value: string; onChange: (c: StageColor) => void; label: string; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {STAGE_COLOR_KEYS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={STAGE_COLORS[c].label}
          title={STAGE_COLORS[c].label}
          disabled={disabled}
          onClick={() => onChange(c)}
          className={cn("size-7 rounded-full ring-offset-2 ring-offset-card transition", STAGE_COLORS[c].bar, value === c ? "ring-2 ring-primary" : "hover:scale-110")}
        />
      ))}
    </div>
  );
}

function RenameStageDialog({
  stage,
  others,
  pending,
  onClose,
  onSave,
}: {
  stage: BoardStage | null;
  others: { name: string }[];
  pending: boolean;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  return (
    <Dialog open={!!stage} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>{stage ? <RenameBody key={stage.id} stage={stage} others={others} pending={pending} onClose={onClose} onSave={onSave} /> : null}</DialogContent>
    </Dialog>
  );
}

function RenameBody({ stage, others, pending, onClose, onSave }: { stage: BoardStage; others: { name: string }[]; pending: boolean; onClose: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState(stage.name);
  const [touched, setTouched] = useState(false);
  const problem = stageNameProblem(name, others);
  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (!problem) onSave(name);
      }}
    >
      <DialogHeader>
        <DialogTitle>Rename “{stage.name}”</DialogTitle>
        <DialogDescription>The new name shows on the board straight away, for everyone.</DialogDescription>
      </DialogHeader>
      <Field label="Stage name" required error={touched ? (problem ?? undefined) : undefined} helper="e.g. Follow-up">
        {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus />}
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null} Save name
        </Button>
      </DialogFooter>
    </form>
  );
}

function DeleteStageDialog({
  stage,
  count,
  targets,
  pending,
  onClose,
  onDelete,
}: {
  stage: BoardStage | null;
  count: number;
  targets: BoardStage[];
  pending: boolean;
  onClose: () => void;
  onDelete: (moveTo: string | null) => void;
}) {
  return (
    <Dialog open={!!stage} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>{stage ? <DeleteBody key={stage.id} stage={stage} count={count} targets={targets} pending={pending} onClose={onClose} onDelete={onDelete} /> : null}</DialogContent>
    </Dialog>
  );
}

function DeleteBody({
  stage,
  count,
  targets,
  pending,
  onClose,
  onDelete,
}: {
  stage: BoardStage;
  count: number;
  targets: BoardStage[];
  pending: boolean;
  onClose: () => void;
  onDelete: (moveTo: string | null) => void;
}) {
  const [moveTo, setMoveTo] = useState("");
  const [touched, setTouched] = useState(false);
  const error = count && !moveTo ? "Please choose where to move them." : undefined;
  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (!error) onDelete(count ? moveTo : null);
      }}
    >
      <DialogHeader>
        <DialogTitle>Delete the “{stage.name}” stage?</DialogTitle>
        <DialogDescription>{count ? "Its enquiries are moved first, so nothing is lost." : "It has no enquiries. The column is removed from the board for everyone."}</DialogDescription>
      </DialogHeader>
      {count ? (
        <Field label={`Move its ${count} ${count === 1 ? "enquiry" : "enquiries"} to:`} required error={touched ? error : undefined} helper="Only open stages are listed. Won and Lost need their own steps.">
          {(p) => (
            <Select value={moveTo} onValueChange={setMoveTo}>
              <SelectTrigger {...p} className="w-full">
                <SelectValue placeholder="Choose a stage" />
              </SelectTrigger>
              <SelectContent>
                {targets.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    <span className={cn("size-2.5 rounded-full", stageColor(s.color).dot)} aria-hidden /> {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Field>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Keep it
        </Button>
        <Button type="submit" disabled={pending} className="bg-destructive text-white hover:bg-destructive/90">
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {count ? "Move and delete" : "Delete stage"}
        </Button>
      </DialogFooter>
    </form>
  );
}
