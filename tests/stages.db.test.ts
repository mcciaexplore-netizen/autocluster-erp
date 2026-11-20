import { asc, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createLead, deleteLeads } from "@/db/lead-writer";
import * as s from "@/db/schema";
import { addStage, changeStageType, deleteStage, moveStage, renameStage, reorderStages, setStageColor, setStageProbability } from "@/db/stage-writer";
import { freshDemoData, testDb } from "./helpers";

const skip = !!process.env.SKIP_DB_TESTS;
const { db, pool } = testDb();
const base = { title: "Enquiry", companyName: "Kalyani Tooling", contactName: "Neha Patil", phone: "9822012345" };

const stages = () => db.select().from(s.crmStages).orderBy(asc(s.crmStages.sortOrder));
const names = async () => (await stages()).map((x) => x.name);
const byName = async (n: string) => (await stages()).find((x) => x.name === n)!;

describe.skipIf(skip)("editing stages (database)", () => {
  beforeEach(async () => {
    await freshDemoData(db);
  });
  afterAll(async () => {
    await pool.end();
  });

  it("Won and Lost can't be deleted or change type; there is always exactly one of each", async () => {
    const won = await byName("Won");
    const lost = await byName("Lost");
    await expect(deleteStage(db, won.id)).rejects.toThrow(/Won stage can't be deleted/);
    await expect(deleteStage(db, lost.id)).rejects.toThrow(/Lost stage can't be deleted/);
    await expect(changeStageType(db, won.id, "OPEN")).rejects.toThrow(/can't be changed to another type/);
    await expect(changeStageType(db, lost.id, "WON")).rejects.toThrow(/can't be changed/);
    await expect(changeStageType(db, (await byName("New")).id, "WON")).rejects.toThrow(/only be one Won/);
    const after = await stages();
    expect(after.filter((x) => x.type === "WON")).toHaveLength(1);
    expect(after.filter((x) => x.type === "LOST")).toHaveLength(1);
  });

  it("but they can be renamed, recoloured and reordered", async () => {
    const won = await byName("Won");
    await renameStage(db, won.id, "Order received");
    await setStageColor(db, won.id, "teal");
    const ids = (await stages()).map((x) => x.id);
    await reorderStages(db, [ids[0], ids[1], ids[2], ids[4], ids[3]]); // Lost before Won
    expect(await names()).toEqual(["New", "Contacted", "Negotiation", "Lost", "Order received"]);
    expect((await byName("Order received")).color).toBe("teal");
    await expect(setStageColor(db, won.id, "rainbow")).rejects.toThrow(/colours shown/);
  });

  it("reordering can't put an open stage after Won or Lost", async () => {
    const ids = (await stages()).map((x) => x.id);
    await expect(reorderStages(db, [ids[0], ids[1], ids[3], ids[2], ids[4]])).rejects.toThrow(/right of the open stages/);
    await expect(reorderStages(db, [ids[3], ids[0], ids[1], ids[2], ids[4]])).rejects.toThrow(/right of the open stages/);
    await expect(moveStage(db, ids[2], 1)).rejects.toThrow(/right of the open stages/); // Negotiation past Won
    await expect(reorderStages(db, ids.slice(0, 4))).rejects.toThrow(/changed while you were editing/);
    expect(await names()).toEqual(["New", "Contacted", "Negotiation", "Won", "Lost"]);
    await moveStage(db, ids[1], -1); // Contacted left
    expect(await names()).toEqual(["Contacted", "New", "Negotiation", "Won", "Lost"]);
  });

  it("a new stage is an open stage placed before Won; names are unique", async () => {
    await addStage(db, "Site visit");
    expect(await names()).toEqual(["New", "Contacted", "Negotiation", "Site visit", "Won", "Lost"]);
    expect((await byName("Site visit")).type).toBe("OPEN");
    await expect(addStage(db, "site VISIT")).rejects.toThrow(/already a stage/);
    await expect(renameStage(db, (await byName("New")).id, "Won")).rejects.toThrow(/already a stage/);
    await expect(setStageProbability(db, (await byName("New")).id, 120)).rejects.toThrow(/0 to 100/);
  });

  it("deleting a stage with enquiries moves them to the chosen stage first, and nothing is lost", async () => {
    const visit = await addStage(db, "Site visit");
    const a = await createLead(db, { ...base, stageId: visit.id });
    const b = await createLead(db, { ...base, title: "Second", stageId: visit.id });
    const gone = await createLead(db, { ...base, title: "Deleted one", stageId: visit.id });
    await deleteLeads(db, [gone.id]);
    const neg = await byName("Negotiation");
    await expect(deleteStage(db, visit.id)).rejects.toThrow(/has 2 enquiries/);
    await expect(deleteStage(db, visit.id, (await byName("Lost")).id)).rejects.toThrow(/open stage/);
    await expect(deleteStage(db, visit.id, visit.id)).rejects.toThrow(/different stage/);
    const r = await deleteStage(db, visit.id, neg.id);
    expect(r).toMatchObject({ moved: 2, to: "Negotiation" });
    const moved = await db.select().from(s.leads).where(eq(s.leads.stageId, neg.id));
    expect(moved.map((l) => l.id).sort()).toEqual([a.id, b.id, gone.id].sort()); // the deleted one too
    expect(await db.select().from(s.leads)).toHaveLength(3);
    const [ev] = await db.select().from(s.leadEvents).where(eq(s.leadEvents.leadId, a.id)).orderBy(asc(s.leadEvents.id)).offset(1);
    expect(ev.message).toBe("Moved from Site visit to Negotiation (the Site visit stage was deleted)");
    expect(await names()).toEqual(["New", "Contacted", "Negotiation", "Won", "Lost"]);
  });

  it("an empty stage just goes; the last open stage stays; the quotation move setting follows", async () => {
    const neg = await byName("Negotiation");
    const r = await deleteStage(db, neg.id);
    expect(r.quoteMoveChangedTo).toBe("Don't move");
    expect((await db.select().from(s.settings))[0].quoteCreatedMoveToStageId).toBeNull();
    await deleteStage(db, (await byName("Contacted")).id);
    await expect(deleteStage(db, (await byName("New")).id)).rejects.toThrow(/at least one open stage/);
  });

  it("every change is logged with who and what", async () => {
    await renameStage(db, (await byName("Contacted")).id, "Follow-up");
    await addStage(db, "Site visit");
    const log = await db.select().from(s.crmStageChanges).orderBy(asc(s.crmStageChanges.id));
    expect(log.map((l) => [l.action, l.details, l.createdBy])).toEqual([
      ["RENAME", { stage: "Contacted", to: "Follow-up" }, "Demo User"],
      ["ADD", { stage: "Site visit" }, "Demo User"],
    ]);
  });
});
