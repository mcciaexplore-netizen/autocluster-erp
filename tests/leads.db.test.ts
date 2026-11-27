import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { bulkAddTag, bulkAssign, bulkMove, createLead, deleteLeads, moveLead, restoreLeads } from "@/db/lead-writer";
import * as s from "@/db/schema";
import { freshDemoData, testDb } from "./helpers";

const skip = !!process.env.SKIP_DB_TESTS;
const { db, pool } = testDb();

const base = { title: "3D printing of 20 prototype parts", companyName: "Kalyani Tooling", contactName: "Neha Patil", phone: "98220 12345" };

async function stage(name: string) {
  const [st] = await db.select().from(s.crmStages).where(eq(s.crmStages.name, name));
  return st;
}
async function events(leadId: string) {
  return db.select().from(s.leadEvents).where(eq(s.leadEvents.leadId, leadId)).orderBy(s.leadEvents.id);
}

describe.skipIf(skip)("enquiries (database)", () => {
  beforeEach(async () => {
    await freshDemoData(db);
  });
  afterAll(async () => {
    await pool.end();
  });

  it("10 enquiries created at the same moment get 10 different numbers, in order", async () => {
    const made = await Promise.all(Array.from({ length: 10 }, (_, i) => createLead(db, { ...base, title: `Enquiry ${i}` })));
    const nos = made.map((l) => l.leadNo);
    expect(new Set(nos).size).toBe(10);
    expect([...nos].sort()).toEqual(Array.from({ length: 10 }, (_, i) => `DMC/EN/2026-27/${String(i + 1).padStart(4, "0")}`));
  });

  it("a new enquiry starts in the first open stage (source 'Other' if none given) with a Created entry", async () => {
    const l = await createLead(db, base);
    expect(l.stageId).toBe((await stage("New")).id);
    const [src] = await db.select().from(s.crmSources).where(eq(s.crmSources.id, l.sourceId));
    expect(src.name).toBe("Other");
    expect(l.phone).toBe("9822012345");
    expect((await events(l.id)).map((e) => e.type)).toEqual(["CREATED"]);
  });

  it("checks the details in plain words, and needs a mobile or an email", async () => {
    await expect(createLead(db, { ...base, title: " " })).rejects.toThrow(/enquiry title/);
    await expect(createLead(db, { ...base, phone: "12345" })).rejects.toThrow(/10 digits/);
    await expect(createLead(db, { ...base, phone: null })).rejects.toThrow(/mobile number or an email/);
    await expect(createLead(db, { ...base, phone: null, email: "nope" })).rejects.toThrow(/email address/);
    await expect(createLead(db, { ...base, phone: null, email: "neha@kalyani.example" })).resolves.toBeTruthy();
  });

  it("moving to Lost without a reason is refused; with a reason it records it", async () => {
    const l = await createLead(db, base);
    const lost = await stage("Lost");
    await expect(moveLead(db, l.id, lost.id)).rejects.toThrow(/why the enquiry was lost/);
    expect((await db.select().from(s.leads).where(eq(s.leads.id, l.id)))[0].stageId).not.toBe(lost.id);
    const [reason] = await db.select().from(s.crmLostReasons).where(eq(s.crmLostReasons.name, "Price too high"));
    const r = await moveLead(db, l.id, lost.id, { lostReasonId: reason.id, lostNote: "Chakan lab was cheaper" });
    expect(r).toMatchObject({ changed: true, toType: "LOST" });
    const [after] = await db.select().from(s.leads).where(eq(s.leads.id, l.id));
    expect(after).toMatchObject({ stageId: lost.id, lostReasonId: reason.id, lostNote: "Chakan lab was cheaper" });
    expect(after.lostAt).toBeTruthy();
    expect((await events(l.id)).at(-1)?.message).toBe("Marked as lost: Price too high. Chakan lab was cheaper");
  });

  it("won records the time; moving back to an open stage reopens it and logs it", async () => {
    const l = await createLead(db, base);
    const won = await stage("Won");
    const neg = await stage("Negotiation");
    await moveLead(db, l.id, won.id);
    expect((await db.select().from(s.leads).where(eq(s.leads.id, l.id)))[0].wonAt).toBeTruthy();
    const r = await moveLead(db, l.id, neg.id);
    expect(r).toMatchObject({ fromType: "WON", toType: "OPEN" });
    const [after] = await db.select().from(s.leads).where(eq(s.leads.id, l.id));
    expect(after.wonAt).toBeNull();
    expect((await events(l.id)).map((e) => e.type)).toEqual(["CREATED", "WON", "REOPENED"]);
    // moving to the same stage changes nothing
    expect((await moveLead(db, l.id, neg.id)).changed).toBe(false);
  });

  it("bulk: change stage, assign, add tag, delete and undo", async () => {
    const a = await createLead(db, base);
    const b = await createLead(db, { ...base, title: "UTM tests" });
    const contacted = await stage("Contacted");
    expect(await bulkMove(db, [a.id, b.id], contacted.id)).toEqual({ moved: 2 });
    await expect(bulkMove(db, [a.id], (await stage("Lost")).id)).rejects.toThrow(/why/);
    const [m] = await db.insert(s.teamMembers).values({ name: "Priya Shah" }).returning();
    expect(await bulkAssign(db, [a.id, b.id], m.id)).toEqual({ changed: 2 });
    expect((await events(a.id)).at(-1)?.message).toBe("Assigned to changed from nobody to Priya Shah");
    const [tag] = await db.select().from(s.crmTags).where(eq(s.crmTags.name, "Urgent"));
    expect(await bulkAddTag(db, [a.id, b.id], tag.id)).toEqual({ added: 2 });
    expect(await bulkAddTag(db, [a.id], tag.id)).toEqual({ added: 0 });
    expect(await deleteLeads(db, [a.id])).toEqual({ deleted: 1 });
    await expect(bulkAssign(db, [a.id], null)).rejects.toThrow(/could not be found/);
    expect(await restoreLeads(db, [a.id])).toEqual({ restored: 1 });
    expect((await events(a.id)).map((e) => e.type).slice(-2)).toEqual(["DELETED", "RESTORED"]);
  });
});
