import { eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as s from "@/db/schema";
import { invoiceBalance } from "@/db/payment-writer";
import { toPaise } from "@/lib/pricing";
import { daysBetween, todayInIndia } from "@/lib/tickets";
import { loadDemoData, wipe } from "@/scripts/demo-data";
import { testDb } from "./helpers";

const skip = !!process.env.SKIP_DB_TESTS;
const { db, pool } = testDb();

describe.skipIf(skip)("demo data (database)", () => {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  beforeAll(async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN; // never upload from tests
    await db.transaction(async (tx) => {
      await wipe(tx);
      await loadDemoData(tx, { quiet: true, orders: { blobFolder: "local" }, crm: true });
    });
  });
  afterAll(async () => {
    if (token) process.env.BLOB_READ_WRITE_TOKEN = token;
    await pool.end();
  });

  it("shows every situation on the board", async () => {
    const ts = await db.select().from(s.tickets);
    const count = (st: string) => ts.filter((t) => t.stage === st).length;
    expect({ w: count("WAITING_PO"), b: count("BILLING"), p: count("PAYMENT"), paid: count("PAID"), c: count("CANCELLED") }).toEqual({ w: 2, b: 2, p: 3, paid: 1, c: 1 });
    // the 2 Billing tickets share one PO
    expect(new Set(ts.filter((t) => t.stage === "BILLING").map((t) => t.poId)).size).toBe(1);
    // the MSME member SLA quotation is left as Sent, for the "mark it Accepted" demo step
    const [sla] = await db.select().from(s.quotations).where(eq(s.quotations.quoteNo, "DMC/QT/2026-27/0001"));
    expect(sla.status).toBe("SENT");
    expect(toPaise(sla.grandTotal)).toBe(8_496_00);
  });

  it("due dates: in 5 days, today, overdue by 12 days (with a note and a part payment incl. TDS)", async () => {
    const today = todayInIndia();
    const open = await db.select({ t: s.tickets, i: s.invoices }).from(s.tickets).innerJoin(s.invoices, eq(s.invoices.id, s.tickets.invoiceId)).where(eq(s.tickets.stage, "PAYMENT"));
    expect(open.map((r) => daysBetween(today, r.i.dueDate)).sort((a, b) => a - b)).toEqual([-12, 0, 5]);
    const overdue = open.find((r) => daysBetween(today, r.i.dueDate) === -12)!;
    const pays = await db.select().from(s.payments).where(eq(s.payments.invoiceId, overdue.i.id));
    expect(pays).toHaveLength(1);
    expect(toPaise(pays[0].tdsAmount)).toBeGreaterThan(0);
    expect(await db.select().from(s.followUps).where(eq(s.followUps.invoiceId, overdue.i.id))).toHaveLength(1);
    const left = (await invoiceBalance(db, overdue.i.id))!;
    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThan(toPaise(overdue.i.amount));
  });

  it("every invoice equals its tickets' totals, and every file is a sample PDF row", async () => {
    const invs = await db.select().from(s.invoices);
    for (const inv of invs) {
      const ts = await db.select().from(s.tickets).where(eq(s.tickets.invoiceId, inv.id));
      expect(ts.reduce((a, t) => a + toPaise(t.totalAmount), 0)).toBe(toPaise(inv.amount));
    }
    const files = await db.select().from(s.files);
    expect(files.filter((f) => f.kind === "PO")).toHaveLength(5);
    expect(files.filter((f) => f.kind === "INVOICE")).toHaveLength(4);
    expect(files.every((f) => f.blobPath.startsWith("local/") && f.mime === "application/pdf")).toBe(true);
  });

  it("CRM: 12 enquiries across every stage, all sources and priorities, the right activities", async () => {
    const leads = await db.select({ l: s.leads, stage: s.crmStages.name, type: s.crmStages.type }).from(s.leads).innerJoin(s.crmStages, eq(s.crmStages.id, s.leads.stageId));
    expect(leads).toHaveLength(12);
    const by = (n: string) => leads.filter((x) => x.stage === n).length;
    expect({ n: by("New"), c: by("Contacted"), g: by("Negotiation"), w: by("Won"), l: by("Lost") }).toEqual({ n: 3, c: 3, g: 2, w: 2, l: 2 });
    expect(new Set(leads.map((x) => x.l.sourceId)).size).toBe((await db.select().from(s.crmSources)).length);
    expect([...new Set(leads.map((x) => x.l.priority))].sort()).toEqual([0, 1, 2, 3]);
    expect((await db.select().from(s.teamMembers)).map((m) => m.name)).toEqual(["Priya Shah", "Rohan Deshpande", "Amit Patil"]);
    expect((await db.select().from(s.crmTags)).map((t) => t.name)).toEqual(["Urgent", "Repeat customer", "Government", "Startup"]);
    expect(leads.filter((x) => x.l.customerId).length).toBeGreaterThanOrEqual(4); // a mix of existing customers and new companies

    const today = todayInIndia();
    const planned = await db.select().from(s.crmActivities).where(isNull(s.crmActivities.doneAt));
    const d = planned.map((a) => daysBetween(today, a.dueDate));
    expect({ overdue: d.filter((x) => x < 0).length, today: d.filter((x) => x === 0).length, upcoming: d.filter((x) => x > 0).length }).toEqual({ overdue: 2, today: 2, upcoming: 3 });
    const withPlan = new Set(planned.map((a) => a.leadId));
    expect(leads.filter((x) => x.type === "OPEN" && !withPlan.has(x.l.id))).toHaveLength(2);

    const reasons = await db.select({ name: s.crmLostReasons.name }).from(s.leads).innerJoin(s.crmLostReasons, eq(s.crmLostReasons.id, s.leads.lostReasonId));
    expect(reasons.map((r) => r.name).sort()).toEqual(["No response", "Price too high"]);
  });

  it("CRM links: Won with Sahyadri's accepted quotation, Won converted to a new customer, Negotiation with a Sent quotation; values match the quotation before GST", async () => {
    const linked = await db.select({ q: s.quotations, l: s.leads, stage: s.crmStages.name }).from(s.quotations).innerJoin(s.leads, eq(s.leads.id, s.quotations.leadId)).innerJoin(s.crmStages, eq(s.crmStages.id, s.leads.stageId));
    expect(linked.map((x) => `${x.stage}:${x.q.status}:${x.q.customerSnapshot.companyName.split(" ")[0]}`).sort()).toEqual(["Negotiation:SENT:Western", "Won:ACCEPTED:Sahyadri"]);
    for (const x of linked) expect(x.l.expectedValue).toBe(toPaise(x.q.taxableValue));
    const [conv] = await db.select({ l: s.leads, c: s.customers }).from(s.leads).innerJoin(s.customers, eq(s.customers.id, s.leads.customerId)).where(eq(s.customers.companyName, "Pune Precision Moulds Pvt Ltd"));
    expect(conv.c.status).toBe("ACTIVE");
    const events = await db.select().from(s.leadEvents).where(eq(s.leadEvents.leadId, conv.l.id));
    expect(events.map((e) => e.message)).toContain("Converted to customer: Pune Precision Moulds Pvt Ltd");
  });
});
