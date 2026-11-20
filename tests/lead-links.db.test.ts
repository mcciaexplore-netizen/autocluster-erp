import { asc, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createQuotationFromLead, linkLeadToCustomer } from "@/db/lead-links";
import { createLead, moveLead } from "@/db/lead-writer";
import type { QuotationInput } from "@/db/quote-writer";
import * as s from "@/db/schema";
import { changeQuotationStatus } from "@/db/ticket-writer";
import { customerPrefillFromLead } from "@/lib/crm/convert";
import { freshDemoData, testDb } from "./helpers";

const skip = !!process.env.SKIP_DB_TESTS;
const { db, pool } = testDb();
const TODAY = "2026-11-20";

async function setup() {
  const [cust] = (await db.select().from(s.customers)).filter((c) => c.companyName.startsWith("Western Drive"));
  const [svc] = (await db.select().from(s.services)).filter((x) => x.name === "UTM");
  const stages = await db.select().from(s.crmStages).orderBy(asc(s.crmStages.sortOrder));
  const by = (n: string) => stages.find((x) => x.name === n)!;
  const lead = await createLead(db, { title: "UTM tests for seals", companyName: cust.companyName, contactName: cust.pocName, phone: cust.pocPhone, customerId: cust.id, serviceIds: [svc.id] });
  const input: QuotationInput = {
    customerId: cust.id,
    quoteDate: TODAY,
    validUntil: "2026-12-20",
    subject: "UTM",
    notes: null,
    terms: "-",
    status: "SENT",
    lines: [{ key: "a", serviceId: svc.id, deptCode: svc.deptCode, description: svc.name, unitType: svc.unitType, unitLabel: svc.unitLabel, customRatePaise: null, samples: 3 }],
  };
  return { cust, lead, input, by };
}
const leadRow = async (id: string) => (await db.select().from(s.leads).where(eq(s.leads.id, id)))[0];
const events = async (id: string) => (await db.select().from(s.leadEvents).where(eq(s.leadEvents.leadId, id)).orderBy(asc(s.leadEvents.id))).map((e) => e.message);

describe.skipIf(skip)("enquiries linked to quotations and customers (database)", () => {
  beforeEach(async () => {
    await freshDemoData(db);
  });
  afterAll(async () => {
    await pool.end();
  });

  it("a quotation made from an enquiry saves lead_id and follows the automatic move (default Negotiation)", async () => {
    const { lead, input, by } = await setup();
    const q = await createQuotationFromLead(db, input, lead.id);
    expect(q.movedTo).toBe("Negotiation");
    expect((await db.select().from(s.quotations).where(eq(s.quotations.id, q.id)))[0].leadId).toBe(lead.id);
    expect((await leadRow(lead.id)).stageId).toBe(by("Negotiation").id);
    expect(await events(lead.id)).toEqual(["Enquiry created in New", `Quotation ${q.quoteNo} created`, `Moved from New to Negotiation: quotation ${q.quoteNo} created`]);
  });

  it("'Don't move' leaves the stage alone, and a Won or Lost enquiry is never reopened", async () => {
    const { lead, input, by } = await setup();
    await db.update(s.settings).set({ quoteCreatedMoveToStageId: null });
    const q = await createQuotationFromLead(db, input, lead.id);
    expect(q.movedTo).toBeNull();
    expect((await leadRow(lead.id)).stageId).toBe(by("New").id);
    await db.update(s.settings).set({ quoteCreatedMoveToStageId: by("Contacted").id });
    await moveLead(db, lead.id, by("Won").id);
    expect((await createQuotationFromLead(db, input, lead.id)).movedTo).toBeNull();
    expect((await leadRow(lead.id)).stageId).toBe(by("Won").id);
  });

  it("accepting the quotation moves the enquiry to Won exactly once (and tickets open as usual)", async () => {
    const { lead, input, by } = await setup();
    const q = await createQuotationFromLead(db, input, lead.id);
    const r1 = await changeQuotationStatus(db, q.id, "ACCEPTED", TODAY);
    expect(r1).toMatchObject({ opened: 1, leadWon: lead.leadNo });
    expect((await leadRow(lead.id)).stageId).toBe(by("Won").id);
    // Accepted -> Sent -> Accepted again: no second Won entry
    await changeQuotationStatus(db, q.id, "SENT", TODAY);
    const r2 = await changeQuotationStatus(db, q.id, "ACCEPTED", TODAY);
    expect(r2.leadWon).toBeNull();
    const won = (await events(lead.id)).filter((m) => m.startsWith("Marked as won"));
    expect(won).toEqual([`Marked as won: quotation ${q.quoteNo} was accepted`]);
    expect(await db.select().from(s.tickets).where(eq(s.tickets.quotationId, q.id))).toHaveLength(1);
  });

  it("a rejected quotation doesn't move the enquiry, only notes it", async () => {
    const { lead, input, by } = await setup();
    const q = await createQuotationFromLead(db, input, lead.id);
    await changeQuotationStatus(db, q.id, "REJECTED", TODAY);
    expect((await leadRow(lead.id)).stageId).toBe(by("Negotiation").id);
    expect((await events(lead.id)).at(-1)).toBe(`Quotation ${q.quoteNo} was rejected`);
  });

  it("convert to customer: the form is pre-filled from the enquiry, and the new customer is linked", async () => {
    const lead = await createLead(db, {
      title: "Salt spray tests",
      companyName: "Bharat Fasteners",
      contactName: "Amit Joshi",
      designation: "QA Head",
      phone: "+91 98900 11122",
      email: "amit@bharat.example",
      city: "Chakan",
      category: "MSME",
      isMcciaMember: true,
      mcciaMembershipId: "MCCIA/2021/0099",
    });
    const l = await leadRow(lead.id);
    expect(customerPrefillFromLead(l)).toEqual({
      companyName: "Bharat Fasteners",
      pocName: "Amit Joshi",
      pocDesignation: "QA Head",
      pocPhone: "9890011122",
      pocEmail: "amit@bharat.example",
      city: "Chakan",
      category: "MSME",
      isMcciaMember: "yes",
      mcciaMembershipId: "MCCIA/2021/0099",
    });
    const [c] = await db
      .insert(s.customers)
      .values({ companyName: "Bharat Fasteners", category: "MSME", addressLine1: "Plot 4", city: "Chakan", state: "Maharashtra", stateCode: "27", pincode: "410501", pan: "AAACB1234C", pocName: "Amit Joshi", pocPhone: "9890011122", pocEmail: "amit@bharat.example", status: "ACTIVE" })
      .returning();
    expect(await linkLeadToCustomer(db, lead.id, c.id)).toEqual({ linked: true, companyName: "Bharat Fasteners" });
    expect((await leadRow(lead.id)).customerId).toBe(c.id);
    expect((await events(lead.id)).at(-1)).toBe("Converted to customer: Bharat Fasteners");
    expect((await linkLeadToCustomer(db, lead.id, c.id)).linked).toBe(false);
  });

  it("a quotation for a different customer than the enquiry's is refused", async () => {
    const { lead, input } = await setup();
    const [other] = (await db.select().from(s.customers)).filter((c) => c.companyName.startsWith("Sahyadri"));
    await expect(createQuotationFromLead(db, { ...input, customerId: other.id }, lead.id)).rejects.toThrow(/different customer/);
  });
});
