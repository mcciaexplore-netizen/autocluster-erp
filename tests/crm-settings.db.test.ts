import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ensureCrmDefaults } from "@/db/crm-defaults";
import { addListItem, deleteListItem, moveListItem, updateListItem } from "@/db/crm-lists-writer";
import * as s from "@/db/schema";
import { DEFAULT_LOST_REASONS, DEFAULT_SOURCES, DEFAULT_TAGS } from "@/lib/crm/stages";
import { freshDemoData, testDb } from "./helpers";

const skip = !!process.env.SKIP_DB_TESTS;
const { db, pool } = testDb();

describe.skipIf(skip)("CRM defaults and lists (database)", () => {
  beforeEach(async () => {
    await freshDemoData(db);
  });
  afterAll(async () => {
    await pool.end();
  });

  it("demo data has the 5 default stages, lists, and Negotiation as the quotation move", async () => {
    const stages = await db.select().from(s.crmStages).orderBy(s.crmStages.sortOrder);
    expect(stages.map((x) => `${x.name}:${x.type}:${x.probability}:${x.color}`)).toEqual([
      "New:OPEN:10:grey",
      "Contacted:OPEN:30:blue",
      "Negotiation:OPEN:60:amber",
      "Won:WON:100:green",
      "Lost:LOST:0:red",
    ]);
    expect((await db.select().from(s.crmSources)).map((x) => x.name).sort()).toEqual([...DEFAULT_SOURCES].sort());
    expect(await db.select().from(s.crmLostReasons)).toHaveLength(DEFAULT_LOST_REASONS.length);
    expect(await db.select().from(s.crmTags)).toHaveLength(DEFAULT_TAGS.length);
    const [set] = await db.select().from(s.settings);
    expect(set.quoteCreatedMoveToStageId).toBe(stages[2].id);
    expect(set.leadPrefix).toBe("DMC/EN");
  });

  it("adding the defaults again changes nothing (safe to run on live)", async () => {
    const [st] = await db.select().from(s.crmStages).where(eq(s.crmStages.name, "Contacted"));
    await db.update(s.crmStages).set({ name: "Follow-up" }).where(eq(s.crmStages.id, st.id));
    expect(await ensureCrmDefaults(db)).toEqual([]);
    expect(await db.select().from(s.crmStages)).toHaveLength(5);
    expect((await db.select().from(s.crmStages).where(eq(s.crmStages.id, st.id)))[0].name).toBe("Follow-up");
  });

  it("list items: add, no duplicates, rename, reorder, delete", async () => {
    const id = await addListItem(db, "sources", { name: "  LinkedIn  " });
    await expect(addListItem(db, "sources", { name: "linkedin" })).rejects.toThrow(/already in the list/);
    await expect(addListItem(db, "sources", { name: " " })).rejects.toThrow(/enter a name/);
    await updateListItem(db, "sources", id, { name: "LinkedIn post" });
    const before = await db.select().from(s.crmSources).orderBy(s.crmSources.sortOrder);
    expect(before.at(-1)?.name).toBe("LinkedIn post");
    await moveListItem(db, "sources", id, -1);
    const after = await db.select().from(s.crmSources).orderBy(s.crmSources.sortOrder);
    expect(after.at(-2)?.name).toBe("LinkedIn post");
    expect(await deleteListItem(db, "sources", id)).toBe("deleted");
    expect(await db.select().from(s.crmSources).where(eq(s.crmSources.id, id))).toHaveLength(0);
  });

  it("team members: mobile and email are checked", async () => {
    await expect(addListItem(db, "team", { name: "Sneha", phone: "12345" })).rejects.toThrow(/10 digits/);
    await expect(addListItem(db, "team", { name: "Sneha", email: "nope" })).rejects.toThrow(/email/);
    const id = await addListItem(db, "team", { name: "Sneha", phone: "+91 98220 12345", email: "sneha@example.com" });
    const [m] = await db.select().from(s.teamMembers).where(eq(s.teamMembers.id, id));
    expect(m).toMatchObject({ phone: "9822012345", email: "sneha@example.com", isActive: true });
  });

  it("an item used by an enquiry is hidden instead of deleted", async () => {
    const [src] = await db.select().from(s.crmSources).limit(1);
    const [stage] = await db.select().from(s.crmStages).limit(1);
    await db.insert(s.leads).values({ leadNo: "T/1", fy: "2026-27", seq: 1, title: "Test", companyName: "X", contactName: "Y", sourceId: src.id, stageId: stage.id });
    expect(await deleteListItem(db, "sources", src.id)).toBe("hidden");
    const [row] = await db.select().from(s.crmSources).where(eq(s.crmSources.id, src.id));
    expect(row.isActive).toBe(false);
  });
});
