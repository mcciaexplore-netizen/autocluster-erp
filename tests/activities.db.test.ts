import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { cancelActivity, markActivityDone, planActivity, timeLabel } from "@/db/activity-writer";
import { createLead } from "@/db/lead-writer";
import * as s from "@/db/schema";
import { freshDemoData, testDb } from "./helpers";

const skip = !!process.env.SKIP_DB_TESTS;
const { db, pool } = testDb();
const TODAY = "2026-11-20";
const base = { title: "Dust test for headlamps", companyName: "Lumax Pune", contactName: "Sunil Rao", phone: "9890011122" };
const events = (leadId: string) => db.select().from(s.leadEvents).where(eq(s.leadEvents.leadId, leadId)).orderBy(s.leadEvents.id);

describe.skipIf(skip)("activities (database)", () => {
  beforeEach(async () => {
    await freshDemoData(db);
  });
  afterAll(async () => {
    await pool.end();
  });

  it("planning defaults to the enquiry's owner and is logged", async () => {
    const [m] = await db.insert(s.teamMembers).values({ name: "Priya Shah" }).returning();
    const l = await createLead(db, { ...base, assignedTo: m.id });
    const a = await planActivity(db, { leadId: l.id, type: "CALL", dueDate: "2026-11-21", dueTime: "10:30", note: "Ask for drawings" }, TODAY);
    expect(a).toMatchObject({ assignedTo: m.id, dueTime: "10:30:00", doneAt: null });
    expect((await events(l.id)).at(-1)?.message).toBe("Call planned for 21 Nov 2026 at 10:30 am (Priya Shah): Ask for drawings");
    // choosing "Not assigned" is respected
    const b = await planActivity(db, { leadId: l.id, type: "MEETING", dueDate: TODAY, assignedTo: null }, TODAY);
    expect(b.assignedTo).toBeNull();
  });

  it("checks the date, time and type in plain words", async () => {
    const l = await createLead(db, base);
    await expect(planActivity(db, { leadId: l.id, type: "CALL", dueDate: "" }, TODAY)).rejects.toThrow(/due date/);
    await expect(planActivity(db, { leadId: l.id, type: "CALL", dueDate: "2026-11-19" }, TODAY)).rejects.toThrow(/past/);
    await expect(planActivity(db, { leadId: l.id, type: "CALL", dueDate: TODAY, dueTime: "25:00" }, TODAY)).rejects.toThrow(/time/);
    await expect(planActivity(db, { leadId: l.id, type: "FAX" as never, dueDate: TODAY }, TODAY)).rejects.toThrow(/type/);
  });

  it("mark done needs an outcome, goes into the history, and can't be done twice", async () => {
    const l = await createLead(db, base);
    const a = await planActivity(db, { leadId: l.id, type: "SITE_VISIT", dueDate: TODAY }, TODAY);
    await expect(markActivityDone(db, a.id, " ")).rejects.toThrow(/short outcome/);
    await markActivityDone(db, a.id, "Saw the test setup, sending quotation");
    const [row] = await db.select().from(s.crmActivities).where(eq(s.crmActivities.id, a.id));
    expect(row.doneAt).toBeTruthy();
    expect(row.outcome).toBe("Saw the test setup, sending quotation");
    expect((await events(l.id)).at(-1)?.message).toBe("Site visit done by Demo User: Saw the test setup, sending quotation");
    await expect(markActivityDone(db, a.id, "again")).rejects.toThrow(/already/);
    await expect(cancelActivity(db, a.id)).rejects.toThrow(/already/);
  });

  it("cancelling removes a planned activity and logs it", async () => {
    const l = await createLead(db, base);
    const a = await planActivity(db, { leadId: l.id, type: "FOLLOW_UP", dueDate: "2026-11-25" }, TODAY);
    await cancelActivity(db, a.id);
    expect(await db.select().from(s.crmActivities).where(eq(s.crmActivities.id, a.id))).toHaveLength(0);
    expect((await events(l.id)).at(-1)?.message).toBe("Follow-up planned for 25 Nov 2026 was cancelled");
  });

  it("time labels", () => {
    expect(timeLabel("00:05")).toBe("12:05 am");
    expect(timeLabel("12:00:00")).toBe("12:00 pm");
    expect(timeLabel("18:45")).toBe("6:45 pm");
  });
});
