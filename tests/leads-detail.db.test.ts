import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { addLeadNote, companyKey, createLead, findDuplicates, logLeadContact, updateLead, type LeadInput } from "@/db/lead-writer";
import * as s from "@/db/schema";
import { freshDemoData, testDb } from "./helpers";

const skip = !!process.env.SKIP_DB_TESTS;
const { db, pool } = testDb();

const base: LeadInput = { title: "UTM tests for rubber seals", companyName: "Kalyani Tooling", contactName: "Neha Patil", phone: "9822012345", email: "neha@kalyani.example" };
const events = (leadId: string) => db.select().from(s.leadEvents).where(eq(s.leadEvents.leadId, leadId)).orderBy(s.leadEvents.id);

describe.skipIf(skip)("enquiry details, history and duplicate check (database)", () => {
  beforeEach(async () => {
    await freshDemoData(db);
  });
  afterAll(async () => {
    await pool.end();
  });

  it("editing logs value, assignee and other changes in plain words", async () => {
    const l = await createLead(db, { ...base, expectedValuePaise: 50_000_00 });
    const [m] = await db.insert(s.teamMembers).values({ name: "Rohan Kulkarni" }).returning();
    const r = await updateLead(db, l.id, { ...base, expectedValuePaise: 75_000_00, assignedTo: m.id, city: "Pune", deptCodes: ["RPL"] });
    expect(r.changed).toBe(true);
    const msgs = (await events(l.id)).map((e) => e.message);
    expect(msgs).toContain("Expected value changed from ₹50,000 to ₹75,000");
    expect(msgs).toContain("Assigned to changed from nobody to Rohan Kulkarni");
    expect(msgs).toContain("Details edited: city, departments");
    // saving again with nothing changed adds nothing
    const before = (await events(l.id)).length;
    expect((await updateLead(db, l.id, { ...base, expectedValuePaise: 75_000_00, assignedTo: m.id, city: "Pune", deptCodes: ["RPL"] })).changed).toBe(false);
    expect(await events(l.id)).toHaveLength(before);
  });

  it("the form can move between open stages and to Won, but not to Lost (that needs a reason)", async () => {
    const l = await createLead(db, base);
    const stages = await db.select().from(s.crmStages);
    const by = (n: string) => stages.find((x) => x.name === n)!.id;
    await expect(updateLead(db, l.id, { ...base, stageId: by("Lost") })).rejects.toThrow(/Mark as lost/);
    const r = await updateLead(db, l.id, { ...base, stageId: by("Contacted") });
    expect(r.moved).toMatchObject({ changed: true, toName: "Contacted" });
  });

  it("notes and contact clicks go into the history", async () => {
    const l = await createLead(db, base);
    await expect(addLeadNote(db, l.id, " ")).rejects.toThrow(/write the note/);
    await addLeadNote(db, l.id, "Drawings coming on Monday");
    await logLeadContact(db, l.id, "WHATSAPP");
    await logLeadContact(db, l.id, "EMAIL");
    const ev = await events(l.id);
    expect(ev.map((e) => [e.type, e.message])).toEqual([
      ["CREATED", "Enquiry created in New"],
      ["NOTE", "Drawings coming on Monday"],
      ["CONTACT_WHATSAPP", "WhatsApp opened by Demo User (+91 9822012345)"],
      ["CONTACT_EMAIL", "Email opened by Demo User (neha@kalyani.example)"],
    ]);
  });

  it("duplicate check finds matches by mobile, email and company name, across enquiries and customers", async () => {
    const [sahyadri] = (await db.select().from(s.customers)).filter((c) => c.companyName.startsWith("Sahyadri"));
    const l = await createLead(db, base);
    // customer by mobile
    let d = await findDuplicates(db, { phone: `+91 ${sahyadri.pocPhone}` });
    expect(d.customers).toEqual([{ id: sahyadri.id, companyName: sahyadri.companyName, matchedOn: ["mobile"] }]);
    // customer by email (any case) and by company name ignoring "Pvt Ltd" and punctuation
    d = await findDuplicates(db, { email: sahyadri.pocEmail.toUpperCase() });
    expect(d.customers[0]?.matchedOn).toEqual(["email"]);
    d = await findDuplicates(db, { companyName: "sahyadri auto components private limited." });
    expect(d.customers[0]?.matchedOn).toEqual(["company name"]);
    // enquiry by mobile, email and company together
    d = await findDuplicates(db, { phone: "98220 12345", email: "NEHA@kalyani.example", companyName: "Kalyani Tooling Pvt. Ltd." });
    expect(d.leads).toEqual([{ id: l.id, leadNo: l.leadNo, title: l.title, companyName: "Kalyani Tooling", matchedOn: ["mobile", "email", "company name"] }]);
    // an enquiry is not its own duplicate
    expect((await findDuplicates(db, { phone: "9822012345", excludeLeadId: l.id })).leads).toEqual([]);
    expect(await findDuplicates(db, { phone: "9000000000", companyName: "Zz" })).toEqual({ customers: [], leads: [] });
  });

  it("company names are compared without Pvt Ltd, punctuation or case", () => {
    expect(companyKey("M/s. Sahyadri Auto Components Pvt. Ltd.")).toBe("sahyadri auto components");
    expect(companyKey("Bharat & Sons Private Limited")).toBe("bharat and sons");
  });
});
