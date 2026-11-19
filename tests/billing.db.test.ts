import ExcelJS from "exceljs";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { addInvoice, dueDateFor } from "@/db/invoice-writer";
import { addPurchaseOrder, registerFile } from "@/db/po-writer";
import * as s from "@/db/schema";
import { changeQuotationStatus } from "@/db/ticket-writer";
import { toPaise } from "@/lib/pricing";
import { buildBillingDocument, exportBilling } from "@/lib/tally";
import { freshDemoData, makeQuote, testDb, ticketsOf } from "./helpers";

const skip = !!process.env.SKIP_DB_TESTS;
const { db, pool } = testDb();
const TODAY = "2026-11-19";
const THREE = [
  { name: "Thermal shock chamber", q: { hours: 48 } },
  { name: "UTM", q: { samples: 5 } },
  { name: "Xenon test chamber", q: { hours: 8, samples: 5 } },
];

async function inBilling() {
  const q = await makeQuote(db, "Western Drive", THREE);
  await changeQuotationStatus(db, q.id, "ACCEPTED", TODAY);
  const ts = await ticketsOf(db, q.id);
  await addPurchaseOrder(db, { ticketIds: ts.map((t) => t.id), poNumber: "PO-1", poDate: TODAY, poAmountPaise: 1000_00 }, TODAY);
  const [quote] = await db.select().from(s.quotations).where(eq(s.quotations.id, q.id));
  return { ts, quote };
}
const invoiceFile = () => registerFile(db, { kind: "INVOICE", blobPath: "local/invoice/x.pdf", fileName: "x.pdf", size: 10, mime: "application/pdf" });

describe.skipIf(skip)("billing and invoices (database)", () => {
  beforeEach(async () => {
    await freshDemoData(db);
  });
  afterAll(async () => {
    await pool.end();
  });

  it("one invoice on 2 tickets moves both to Payment follow-up, due = invoice date + credit days", async () => {
    const { ts } = await inBilling();
    const fileId = await invoiceFile();
    const due = dueDateFor("2026-11-10", 45);
    expect(due).toBe("2026-12-25");
    const r = await addInvoice(db, { ticketIds: [ts[0].id, ts[1].id], invoiceNumber: "INV-1", invoiceDate: "2026-11-10", amountPaise: 5000_00, creditDays: 45, dueDate: due, fileId }, TODAY);
    const after = await ticketsOf(db, ts[0].quotationId);
    expect(after.filter((t) => t.stage === "PAYMENT" && t.invoiceId === r.invoiceId)).toHaveLength(2);
    expect(after.find((t) => t.id === ts[2].id)?.stage).toBe("BILLING");
    const [inv] = await db.select().from(s.invoices).where(eq(s.invoices.id, r.invoiceId));
    expect(inv).toMatchObject({ dueDate: "2026-12-25", creditDays: 45, amount: "5000.00" });
    const ev = await db.select().from(s.ticketEvents).where(eq(s.ticketEvents.type, "INVOICE_UPLOADED"));
    expect(ev).toHaveLength(2);
  });

  it("invoice numbers are unique, a file is required, and dates are checked", async () => {
    const { ts } = await inBilling();
    const fileId = await invoiceFile();
    const base = { invoiceDate: TODAY, amountPaise: 100, creditDays: 30, dueDate: dueDateFor(TODAY, 30), fileId };
    await addInvoice(db, { ...base, ticketIds: [ts[0].id], invoiceNumber: "INV-9" }, TODAY);
    await expect(addInvoice(db, { ...base, ticketIds: [ts[1].id], invoiceNumber: "inv-9" }, TODAY)).rejects.toThrow(/already used/);
    await expect(addInvoice(db, { ...base, ticketIds: [ts[1].id], invoiceNumber: "INV-10", invoiceDate: "2026-11-20", dueDate: "2026-12-20" }, TODAY)).rejects.toThrow(/future/);
    await expect(addInvoice(db, { ...base, ticketIds: [ts[1].id], invoiceNumber: "INV-10", dueDate: "2026-11-01" }, TODAY)).rejects.toThrow(/before the invoice date/);
    const poFile = await registerFile(db, { kind: "PO", blobPath: "local/po/y.pdf", fileName: "y.pdf", size: 1, mime: "application/pdf" });
    await expect(addInvoice(db, { ...base, ticketIds: [ts[1].id], invoiceNumber: "INV-10", fileId: poFile }, TODAY)).rejects.toThrow(/upload the tax invoice/);
    // a ticket already in Payment can't get a second invoice
    await expect(addInvoice(db, { ...base, ticketIds: [ts[0].id], invoiceNumber: "INV-11" }, TODAY)).rejects.toThrow(/not in Billing/);
  });

  it("billing details add up to the quotation and the Excel file has every service", async () => {
    const { ts, quote } = await inBilling();
    const doc = await buildBillingDocument(db, ts.map((t) => t.id), TODAY);
    expect(doc.totals.totalPaise).toBe(toPaise(quote.grandTotal));
    expect(doc.totals.taxablePaise).toBe(toPaise(quote.taxableValue));
    expect(doc.pos).toEqual([{ number: "PO-1", date: TODAY }]);
    expect(doc.customer.gstin).toBeTruthy();

    const result = await exportBilling(db, ts.map((t) => t.id), TODAY);
    expect(result.kind).toBe("file");
    if (result.kind !== "file") return;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(result.bytes.buffer as ArrayBuffer);
    const text: string[] = [];
    wb.worksheets[0].eachRow((r) => r.eachCell((c) => text.push(String(c.value))));
    for (const t of ts) expect(text).toContain(t.ticketNo);
    expect(text.join(" ")).toContain("PO-1");
    expect(text).toContain(String(toPaise(quote.grandTotal) / 100));

    const logs = await db.select().from(s.billingExports);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ method: "EXCEL_MANUAL" });
    expect(logs[0].ticketIds).toHaveLength(3);
    expect(await db.select().from(s.ticketEvents).where(eq(s.ticketEvents.type, "BILLING_EXPORTED"))).toHaveLength(3);
  });
});
