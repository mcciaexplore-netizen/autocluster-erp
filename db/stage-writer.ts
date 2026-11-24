/**
 * Changing the CRM pipeline stages. Every change follows the rules in lib/crm/stages.ts:
 * - exactly one Won and one Lost stage; they can be renamed, recoloured and reordered,
 *   but never deleted or changed to another type
 * - at least one open stage
 * - Won and Lost always stay to the right of the open stages
 * Each change is logged in crm_stage_changes (who, what, when).
 * The screens check canManagePipeline() before calling these.
 */
import { actorName } from "../lib/auth/actor";
import { asc, eq, sql } from "drizzle-orm";
import { STAGE_COLOR_KEYS, stageNameProblem, stageOrderProblem, type StageColor, type StageType } from "@/lib/crm/stages";
import type { DB, Tx } from "./client";
import { logLeadEvent } from "./lead-writer";
import { UserFacingError } from "./quote-writer";
import { crmStageChanges, crmStages, leads, settings, type CrmStage } from "./schema";

async function lockedStages(tx: Tx): Promise<CrmStage[]> {
  // One stage change at a time, so two people can't break the rules together.
  await tx.execute(sql`select pg_advisory_xact_lock(4242003)`);
  return tx.select().from(crmStages).orderBy(asc(crmStages.sortOrder), asc(crmStages.createdAt));
}

function find(stages: CrmStage[], id: string) {
  const s = stages.find((x) => x.id === id);
  if (!s) throw new UserFacingError("That stage no longer exists. Please refresh the page.");
  return s;
}

async function log(tx: Tx, action: string, details: Record<string, unknown>) {
  await tx.insert(crmStageChanges).values({ action, details, createdBy: await actorName() });
}

async function writeOrder(tx: Tx, ordered: CrmStage[]) {
  for (const [i, s] of ordered.entries()) if (s.sortOrder !== i + 1) await tx.update(crmStages).set({ sortOrder: i + 1 }).where(eq(crmStages.id, s.id));
}

export async function renameStage(db: DB, id: string, name: string) {
  return db.transaction(async (tx) => {
    const stages = await lockedStages(tx);
    const s = find(stages, id);
    const n = name.trim().replace(/\s+/g, " ");
    const problem = stageNameProblem(n, stages.filter((x) => x.id !== id));
    if (problem) throw new UserFacingError(problem);
    if (n === s.name) return;
    await tx.update(crmStages).set({ name: n }).where(eq(crmStages.id, id));
    await log(tx, "RENAME", { stage: s.name, to: n });
  });
}

export async function setStageColor(db: DB, id: string, color: string) {
  if (!STAGE_COLOR_KEYS.includes(color as StageColor)) throw new UserFacingError("Please choose one of the colours shown.");
  return db.transaction(async (tx) => {
    const s = find(await lockedStages(tx), id);
    if (s.color === color) return;
    await tx.update(crmStages).set({ color }).where(eq(crmStages.id, id));
    await log(tx, "COLOUR", { stage: s.name, from: s.color, to: color });
  });
}

export async function setStageProbability(db: DB, id: string, probability: number) {
  if (!Number.isInteger(probability) || probability < 0 || probability > 100) throw new UserFacingError("Probability must be a whole number from 0 to 100.");
  return db.transaction(async (tx) => {
    const s = find(await lockedStages(tx), id);
    if (s.probability === probability) return;
    await tx.update(crmStages).set({ probability }).where(eq(crmStages.id, id));
    await log(tx, "PROBABILITY", { stage: s.name, from: s.probability, to: probability });
  });
}

export async function setStageFolded(db: DB, id: string, folded: boolean) {
  return db.transaction(async (tx) => {
    const s = find(await lockedStages(tx), id);
    if (s.isFolded === folded) return;
    await tx.update(crmStages).set({ isFolded: folded }).where(eq(crmStages.id, id));
    await log(tx, folded ? "FOLD" : "UNFOLD", { stage: s.name });
  });
}

/** A stage's type can never change (that would break "exactly one Won and one Lost"). */
export async function changeStageType(db: DB, id: string, type: StageType) {
  return db.transaction(async (tx) => {
    const s = find(await lockedStages(tx), id);
    if (s.type === type) return;
    if (s.type !== "OPEN") throw new UserFacingError(`The ${s.type === "WON" ? "Won" : "Lost"} stage can't be changed to another type. You can rename or recolour it.`);
    throw new UserFacingError("There can only be one Won and one Lost stage, so an open stage can't become Won or Lost.");
  });
}

/** Adds an open stage, placed just before Won and Lost. */
export async function addStage(db: DB, name: string, color: string = "purple") {
  if (!STAGE_COLOR_KEYS.includes(color as StageColor)) color = "purple";
  return db.transaction(async (tx) => {
    const stages = await lockedStages(tx);
    const n = name.trim().replace(/\s+/g, " ");
    const problem = stageNameProblem(n, stages);
    if (problem) throw new UserFacingError(problem);
    const open = stages.filter((s) => s.type === "OPEN");
    const lastOpen = open.at(-1);
    const [row] = await tx
      .insert(crmStages)
      .values({ name: n, color, type: "OPEN", probability: Math.min(90, (lastOpen?.probability ?? 50) + 10), sortOrder: 0 })
      .returning();
    const at = stages.findIndex((s) => s.type !== "OPEN");
    const ordered = [...stages];
    ordered.splice(at < 0 ? ordered.length : at, 0, row);
    await writeOrder(tx, ordered);
    await log(tx, "ADD", { stage: n });
    return row;
  });
}

/** Saves a new board order (every stage id, left to right). */
export async function reorderStages(db: DB, orderedIds: string[]) {
  return db.transaction(async (tx) => {
    const stages = await lockedStages(tx);
    if (orderedIds.length !== stages.length || new Set(orderedIds).size !== stages.length || !orderedIds.every((id) => stages.some((s) => s.id === id)))
      throw new UserFacingError("The stages changed while you were editing. Please refresh the page and try again.");
    const ordered = orderedIds.map((id) => find(stages, id));
    const problem = stageOrderProblem(ordered);
    if (problem) throw new UserFacingError(problem);
    if (ordered.every((s, i) => s.id === stages[i].id)) return;
    await writeOrder(tx, ordered);
    await log(tx, "REORDER", { order: ordered.map((s) => s.name) });
  });
}

/** Column menu: Move left / right by one place (same rules). */
export async function moveStage(db: DB, id: string, dir: -1 | 1) {
  const stages = await db.select().from(crmStages).orderBy(asc(crmStages.sortOrder), asc(crmStages.createdAt));
  const i = stages.findIndex((s) => s.id === id);
  const j = i + dir;
  if (i < 0) throw new UserFacingError("That stage no longer exists. Please refresh the page.");
  if (j < 0 || j >= stages.length) return;
  const ids = stages.map((s) => s.id);
  [ids[i], ids[j]] = [ids[j], ids[i]];
  return reorderStages(db, ids);
}

/** How many enquiries (not deleted) are in each stage. */
export async function stageLeadCounts(db: DB | Tx): Promise<Record<string, number>> {
  const rows = await db.execute<{ stage_id: string; n: string }>(sql`select stage_id, count(*) as n from leads where deleted_at is null group by stage_id`);
  return Object.fromEntries(rows.rows.map((r) => [r.stage_id, Number(r.n)]));
}

/**
 * Deletes a stage. Won and Lost can't be deleted, nor the last open stage.
 * If it has enquiries, they are moved to `moveToId` first (an open stage), so nothing is lost.
 */
export async function deleteStage(db: DB, id: string, moveToId?: string | null) {
  return db.transaction(async (tx) => {
    const stages = await lockedStages(tx);
    const s = find(stages, id);
    if (s.type !== "OPEN") throw new UserFacingError(`The ${s.type === "WON" ? "Won" : "Lost"} stage can't be deleted. You can rename, recolour or reorder it.`);
    if (stages.filter((x) => x.type === "OPEN").length <= 1) throw new UserFacingError("There must be at least one open stage, so this one can't be deleted.");
    // Every enquiry in the stage, including deleted ones (they could be restored later).
    const inStage = await tx.select({ id: leads.id, deletedAt: leads.deletedAt }).from(leads).where(eq(leads.stageId, id)).for("update");
    const live = inStage.filter((l) => !l.deletedAt).length;
    let target: CrmStage | null = null;
    if (inStage.length) {
      if (!moveToId) throw new UserFacingError(`This stage has ${live} ${live === 1 ? "enquiry" : "enquiries"}. Please choose where to move ${live === 1 ? "it" : "them"} first.`);
      target = find(stages, moveToId);
      if (target.id === id) throw new UserFacingError("Please choose a different stage to move the enquiries to.");
      if (target.type !== "OPEN") throw new UserFacingError("Please move them to an open stage. Won and Lost need their own steps (a lost reason, or a customer).");
      const now = new Date();
      await tx.update(leads).set({ stageId: target.id, stageChangedAt: now }).where(eq(leads.stageId, id));
      for (const l of inStage) await logLeadEvent(tx, l.id, "STAGE", `Moved from ${s.name} to ${target.name} (the ${s.name} stage was deleted)`, { from: s.name, to: target.name });
    }
    const [set] = await tx.select({ move: settings.quoteCreatedMoveToStageId }).from(settings).where(eq(settings.id, 1));
    const wasQuoteTarget = set?.move === id;
    if (wasQuoteTarget) await tx.update(settings).set({ quoteCreatedMoveToStageId: target?.id ?? null }).where(eq(settings.id, 1));
    await tx.delete(crmStages).where(eq(crmStages.id, id));
    await writeOrder(tx, stages.filter((x) => x.id !== id));
    await log(tx, "DELETE", { stage: s.name, moved: live, to: target?.name ?? null });
    return { moved: live, to: target?.name ?? null, quoteMoveChangedTo: wasQuoteTarget ? (target?.name ?? "Don't move") : null };
  });
}
