/**
 * Demo orders for the Orders & Billing board, so it shows every situation:
 *   Waiting for PO x2, Billing x2 (one shared PO), Payment follow-up x3
 *   (due in 5 days, due today, overdue by 12 days with a note and a part payment incl. TDS),
 *   Paid x1, Cancelled x1.
 * Everything goes through the real writers, so all amounts follow the real pricing rules.
 * Sample PDFs ("SAMPLE PO", "SAMPLE TAX INVOICE") are made with pdf-lib and uploaded to Blob.
 */
import { put } from "@vercel/blob";
import { inArray, sql } from "drizzle-orm";
import { PDFDocument, rgb, StandardFonts, degrees } from "pdf-lib";
import type { DB, Tx } from "../db/client";
import { addInvoice } from "../db/invoice-writer";
import { addFollowUp, recordPayment } from "../db/payment-writer";
import { addPurchaseOrder, registerFile } from "../db/po-writer";
import { createQuotation } from "../db/quote-writer";
import * as s from "../db/schema";
import { cancelTicket, changeQuotationStatus } from "../db/ticket-writer";
import { blobAuth, blobConfigured } from "../lib/blob";
import { formatDate } from "../lib/format";
import { uploadPath, type BlobEnv } from "../lib/files";
import { paiseToRupeeString, toPaise } from "../lib/pricing";
import { addDays, todayInIndia } from "../lib/tickets";
import { DEFAULT_TERMS } from "../lib/settings-shared";

type Line = { name: string; q: Partial<{ ccPerPart: number; parts: number; hours: number; samples: number }>; notes?: string };

export interface DemoOrdersOptions {
  /** Blob folder for the sample PDFs (local / preview / live). */
  blobFolder: BlobEnv;
  /** Called with every uploaded file path, so a failed reset can clean them up. */
  onUpload?: (path: string) => void;
  log?: (msg: string) => void;
}

const rs = (paise: number) => `Rs. ${Number(paiseToRupeeString(paise)).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

/** A small one-page PDF clearly marked SAMPLE. */
export async function samplePdf(title: string, rows: [string, string][]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]); // A4
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText(title, { x: 150, y: 330, size: 64, font: bold, color: rgb(0.85, 0.2, 0.2), opacity: 0.18, rotate: degrees(35) });
  page.drawRectangle({ x: 40, y: 760, width: 515, height: 50, color: rgb(0.12, 0.16, 0.27) });
  page.drawText(title, { x: 56, y: 778, size: 22, font: bold, color: rgb(1, 1, 1) });
  page.drawText("Demo document for the AutoCluster ERP. Not a real document.", { x: 56, y: 735, size: 10, font, color: rgb(0.75, 0.1, 0.1) });
  let y = 695;
  for (const [k, v] of rows) {
    page.drawText(k, { x: 56, y, size: 11, font: bold, color: rgb(0.2, 0.2, 0.2) });
    for (const [i, part] of v.split("\n").entries()) page.drawText(part, { x: 210, y: y - i * 15, size: 11, font, color: rgb(0.1, 0.1, 0.1) });
    y -= 22 + (v.split("\n").length - 1) * 15;
  }
  return pdf.save();
}

export async function loadDemoOrders(conn: DB | Tx, custIds: Record<string, string>, opts: DemoOrdersOptions) {
  const db = conn as DB; // the writers open their own (nested) transactions
  const log = opts.log ?? (() => {});
  const today = todayInIndia();
  const day = (n: number) => addDays(today, n);
  const svcRows = await db.select().from(s.services);
  const svc = (name: string) => svcRows.find((x) => x.name === name)!;
  if (!blobConfigured()) log("  Note: BLOB_READ_WRITE_TOKEN is not set, so the sample PDFs are listed but not uploaded.");

  async function file(kind: "PO" | "INVOICE", fileName: string, title: string, rows: [string, string][]) {
    const bytes = await samplePdf(title, rows);
    let path = uploadPath(opts.blobFolder, kind, fileName);
    if (blobConfigured()) {
      const b = await put(path, Buffer.from(bytes), { access: "private", addRandomSuffix: true, contentType: "application/pdf", ...blobAuth() });
      path = b.pathname;
      opts.onUpload?.(path);
    }
    return registerFile(db, { kind, blobPath: path, fileName, size: bytes.length, mime: "application/pdf" });
  }

  async function quote(customer: string, quoteDate: string, subject: string, lines: Line[]) {
    const q = await createQuotation(db, {
      customerId: custIds[customer],
      quoteDate,
      validUntil: addDays(quoteDate, 30),
      subject,
      notes: null,
      terms: DEFAULT_TERMS,
      status: "SENT",
      lines: lines.map((l) => {
        const v = svc(l.name);
        return { key: crypto.randomUUID(), serviceId: v.id, deptCode: v.deptCode, description: v.name, unitType: v.unitType, unitLabel: v.unitLabel, customRatePaise: null, notes: l.notes ?? null, ...l.q };
      }),
    });
    await changeQuotationStatus(db, q.id, "ACCEPTED", today);
    const ts = await db.select().from(s.tickets).where(sql`${s.tickets.quotationId} = ${q.id}`).orderBy(s.tickets.seq);
    return { id: q.id, quoteNo: q.quoteNo, tickets: ts };
  }

  type T = (typeof s.tickets.$inferSelect)[];
  const sum = (ts: T, k: "totalAmount" | "taxableValue") => ts.reduce((a, t) => a + toPaise(t[k]), 0);

  async function po(customer: string, ts: T, quoteNo: string, poNumber: string, poDate: string) {
    const fileId = await file("PO", `SAMPLE-PO-${poNumber.replaceAll("/", "-")}.pdf`, "SAMPLE PO", [
      ["Purchase order no.", poNumber],
      ["PO date", formatDate(poDate)],
      ["From", customer],
      ["To", "AutoCluster, Pune"],
      ["Against quotation", quoteNo],
      ["Services", ts.map((t) => `${t.snapshot.description} (${t.snapshot.quantityText})`).join("\n")],
      ["PO amount (before GST)", rs(sum(ts, "taxableValue"))],
    ]);
    await addPurchaseOrder(db, { ticketIds: ts.map((t) => t.id), poNumber, poDate, poAmountPaise: sum(ts, "taxableValue"), fileId, notes: "Received by email from the purchase team" }, today);
  }

  async function invoice(customer: string, ts: T, invoiceNumber: string, invoiceDate: string, creditDays: number) {
    const amount = sum(ts, "totalAmount");
    const fileId = await file("INVOICE", `SAMPLE-INVOICE-${invoiceNumber.replaceAll("/", "-")}.pdf`, "SAMPLE TAX INVOICE", [
      ["Invoice no.", invoiceNumber],
      ["Invoice date", formatDate(invoiceDate)],
      ["Billed to", customer],
      ["Services", ts.map((t) => `${t.ticketNo}: ${t.snapshot.description}`).join("\n")],
      ["Taxable value", rs(sum(ts, "taxableValue"))],
      ["Invoice total incl. GST", rs(amount)],
      ["Due date", formatDate(addDays(invoiceDate, creditDays))],
    ]);
    const r = await addInvoice(db, { ticketIds: ts.map((t) => t.id), invoiceNumber, invoiceDate, amountPaise: amount, creditDays, dueDate: addDays(invoiceDate, creditDays), fileId }, today);
    return r.invoiceId;
  }

  /** Moves the history back in time so the board looks lived-in. */
  async function backdate(ts: T, when: Partial<Record<"OPENED" | "PO_ADDED" | "INVOICE_UPLOADED" | "PAYMENT" | "PAID" | "NOTE" | "CANCELLED", string>>, stageDate: string) {
    const ids = ts.map((t) => t.id);
    for (const [type, d] of Object.entries(when)) {
      await db.execute(sql`update ticket_events set created_at = (${d}::date + time '11:00') at time zone 'Asia/Kolkata' where ticket_id = any(${sql.param(ids)}::uuid[]) and type = ${type}`);
    }
    await db.update(s.tickets).set({ stageChangedAt: sql`(${stageDate}::date + time '11:00') at time zone 'Asia/Kolkata'` }).where(inArray(s.tickets.id, ids));
  }

  const fy = (iso: string) => {
    const [y, m] = iso.split("-").map(Number);
    const start = m >= 4 ? y : y - 1;
    return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
  };
  let invSeq = 451;
  const invNo = (date: string) => `MCCIA/${fy(date)}/0${invSeq++}`;

  // 1) Waiting for PO: one quotation with 2 services, no PO yet.
  log("  Waiting for PO: Deccan Polymers (2 services)");
  const a = await quote("Deccan Polymers LLP", day(-6), "Quotation for Rubber & Polymer Lab services", [
    { name: "Xenon test chamber", q: { hours: 24, samples: 3 }, notes: "Weathering, ISO 4892-2" },
    { name: "Melt flow index", q: { samples: 4 }, notes: "ASTM D1238" },
  ]);
  await backdate(a.tickets, { OPENED: day(-2) }, day(-2));

  // 2) Billing: 2 services on one shared PO (+ a third service the customer dropped -> Cancelled).
  log("  Billing: Kaveri Mobility (2 services, one PO) + 1 cancelled");
  const b = await quote("Kaveri Mobility Parts Pvt Ltd", day(-20), "Quotation for Environmental Testing services", [
    { name: "Dust spray chamber", q: { hours: 24 }, notes: "IP5X dust test" },
    { name: "High-low chamber", q: { hours: 36 }, notes: "-40 °C to +85 °C cycling" },
    { name: "Mini salt spray chamber", q: { hours: 96 }, notes: "Neutral salt spray, ASTM B117" },
  ]);
  await cancelTicket(db, b.tickets[2].id, "Customer will do the salt spray test in-house");
  await backdate([b.tickets[2]], { OPENED: day(-14), CANCELLED: day(-10) }, day(-10));
  await po("Kaveri Mobility Parts Pvt Ltd", b.tickets.slice(0, 2), b.quoteNo, "KMP/PO/2026/1187", day(-8));
  await backdate(b.tickets.slice(0, 2), { OPENED: day(-14), PO_ADDED: day(-8) }, day(-8));

  // 3) Payment follow-up: due in 5 days.
  log("  Payment follow-up: Nashik Precision (due in 5 days)");
  const p1 = await quote("Nashik Precision Tools", day(-40), "Quotation for Rapid Prototyping services", [{ name: "SLS", q: { ccPerPart: 120, parts: 5 }, notes: "Jig and fixture prototypes" }]);
  await po("Nashik Precision Tools", p1.tickets, p1.quoteNo, "NPT-4471", day(-32));
  await invoice("Nashik Precision Tools", p1.tickets, invNo(day(-25)), day(-25), 30);
  await backdate(p1.tickets, { OPENED: day(-35), PO_ADDED: day(-32), INVOICE_UPLOADED: day(-25) }, day(-25));

  // 4) Payment follow-up: due today.
  log("  Payment follow-up: Indus Forge (due today)");
  const p2 = await quote("Indus Forge Tier One Pvt Ltd", day(-45), "Quotation for Prototype Production Facility services", [{ name: "3+1 axis machining", q: { hours: 10 }, notes: "Bracket trial batch" }]);
  await po("Indus Forge Tier One Pvt Ltd", p2.tickets, p2.quoteNo, "4500098812", day(-38));
  await invoice("Indus Forge Tier One Pvt Ltd", p2.tickets, invNo(day(-30)), day(-30), 30);
  await backdate(p2.tickets, { OPENED: day(-40), PO_ADDED: day(-38), INVOICE_UPLOADED: day(-30) }, day(-30));

  // 5) Payment follow-up: overdue by 12 days, with a note and a part payment incl. TDS.
  log("  Payment follow-up: Western Drive (overdue by 12 days, note + part payment with TDS)");
  const p3 = await quote("Western Drive Systems Ltd", day(-60), "Quotation for Environmental Testing services", [{ name: "Water spray chamber", q: { hours: 16 }, notes: "IPX5 water jet test" }]);
  await po("Western Drive Systems Ltd", p3.tickets, p3.quoteNo, "WDS/PO/88213", day(-52));
  const inv3 = await invoice("Western Drive Systems Ltd", p3.tickets, invNo(day(-42)), day(-42), 30);
  const tds3 = Math.round(sum(p3.tickets, "taxableValue") * 0.02); // TDS 2% of the taxable value
  const part3 = Math.round(sum(p3.tickets, "totalAmount") / 2) - tds3;
  await recordPayment(db, { invoiceId: inv3, amountPaise: part3, tdsPaise: tds3, paidOn: day(-6), mode: "BANK", reference: "UTR HDFC0026112345" }, today);
  await addFollowUp(db, { invoiceId: inv3, method: "CALL", note: "Spoke to Mr. Shah in accounts. Balance is waiting for the finance head's approval.", promisedDate: day(3), nextFollowUpDate: today });
  await db.execute(sql`update follow_ups set created_at = (${day(-5)}::date + time '11:00') at time zone 'Asia/Kolkata' where invoice_id = ${inv3}`);
  await db.execute(sql`update payments set created_at = (${day(-6)}::date + time '11:00') at time zone 'Asia/Kolkata' where invoice_id = ${inv3}`);
  await backdate(p3.tickets, { OPENED: day(-55), PO_ADDED: day(-52), INVOICE_UPLOADED: day(-42), PAYMENT: day(-6), NOTE: day(-5) }, day(-42));

  // 6) Paid.
  log("  Paid: Sahyadri (paid in full, with TDS)");
  const p4 = await quote("Sahyadri Auto Components Pvt Ltd", day(-70), "Quotation for Prototype Production Facility services", [{ name: "5-axis machining", q: { hours: 4 }, notes: "Mould insert finishing" }]);
  await po("Sahyadri Auto Components Pvt Ltd", p4.tickets, p4.quoteNo, "SAC/PO/2026/0391", day(-63));
  const inv4 = await invoice("Sahyadri Auto Components Pvt Ltd", p4.tickets, invNo(day(-55)), day(-55), 45);
  const tds4 = Math.round(sum(p4.tickets, "taxableValue") * 0.02);
  await recordPayment(db, { invoiceId: inv4, amountPaise: sum(p4.tickets, "totalAmount") - tds4, tdsPaise: tds4, paidOn: day(-15), mode: "UPI", reference: "UPI 6123 4567 8901" }, today);
  await db.execute(sql`update payments set created_at = (${day(-15)}::date + time '11:00') at time zone 'Asia/Kolkata' where invoice_id = ${inv4}`);
  await backdate(p4.tickets, { OPENED: day(-65), PO_ADDED: day(-63), INVOICE_UPLOADED: day(-55), PAYMENT: day(-15), PAID: day(-15) }, day(-15));
}

/** Which Blob folder a script should use: BLOB_FOLDER if set, else local for a local database and live for anything else. */
export function scriptBlobFolder(databaseUrl: string | undefined): BlobEnv {
  const f = process.env.BLOB_FOLDER;
  if (f === "local" || f === "preview" || f === "live") return f;
  try {
    const h = new URL(databaseUrl ?? "").hostname;
    return h === "localhost" || h === "127.0.0.1" ? "local" : "live";
  } catch {
    return "local";
  }
}
