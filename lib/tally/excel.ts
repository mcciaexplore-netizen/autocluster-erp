/** Manual version: an Excel file with everything needed to type the invoice into TallyPrime. */
import ExcelJS from "exceljs";
import { formatDate } from "../format";
import type { BillingDocument, BillingExporter } from "./types";

const rupees = (paise: number) => paise / 100;
const MONEY = '"₹"#,##,##0.00;-"₹"#,##,##0.00';

export function billingFileName(doc: BillingDocument): string {
  const company = doc.customer.companyName.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  const first = doc.ticketNos[0]?.split("/").pop() ?? "";
  return `Billing-${company}-TK${first}${doc.ticketNos.length > 1 ? `-and-${doc.ticketNos.length - 1}-more` : ""}.xlsx`;
}

export async function billingWorkbook(doc: BillingDocument): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ERPOne";
  wb.created = new Date();
  const ws = wb.addWorksheet("Billing details", { pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });

  ws.columns = [
    { width: 6 },
    { width: 24 },
    { width: 40 },
    { width: 30 },
    { width: 12 },
    { width: 14 },
    { width: 10 },
    { width: 14 },
    { width: 16 },
    { width: 13 },
    { width: 13 },
    { width: 13 },
    { width: 16 },
  ];

  const title = ws.addRow(["Billing details for tax invoice"]);
  title.font = { bold: true, size: 14 };
  ws.addRow([`Prepared on ${formatDate(doc.preparedOn)}. Use these details to create the invoice in TallyPrime.`]).font = { italic: true, color: { argb: "FF555555" } };
  ws.addRow([]);

  const info: [string, string][] = [
    ["Customer", doc.customer.companyName],
    ["GSTIN", doc.customer.gstin ?? "Not GST registered"],
    ["Address", doc.customer.address],
    ["State", doc.customer.state],
    ["State code", doc.customer.stateCode],
    ["Contact", `${doc.customer.pocName}, ${doc.customer.pocPhone}, ${doc.customer.pocEmail}`],
    ["PO no. and date", doc.pos.map((p) => `${p.number} dated ${formatDate(p.date)}`).join("; ") || "-"],
    ["Quotation no.", doc.quoteNos.join(", ")],
    ["Ticket no(s).", doc.ticketNos.join(", ")],
    ["GST", doc.intraState ? `CGST ${doc.gstPct / 2}% + SGST ${doc.gstPct / 2}% (same state)` : `IGST ${doc.gstPct}% (other state)`],
  ];
  for (const [k, v] of info) {
    const r = ws.addRow([k, "", v]);
    ws.mergeCells(r.number, 1, r.number, 2);
    ws.mergeCells(r.number, 3, r.number, 13);
    r.getCell(1).font = { bold: true };
    r.getCell(3).alignment = { wrapText: true, vertical: "top" };
  }
  ws.addRow([]);

  const header = ws.addRow([
    "No.",
    "Ticket no.",
    "Service",
    "Quantity",
    "Billable qty",
    "Unit",
    "Discount %",
    "Rate (list)",
    "Rate (after discount)",
    "Taxable value",
    doc.intraState ? "CGST" : "IGST",
    doc.intraState ? "SGST" : "",
    "Total",
  ]);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.alignment = { wrapText: true, vertical: "middle" };
  header.eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2A44" } };
  });

  doc.lines.forEach((l, i) => {
    const r = ws.addRow([
      i + 1,
      l.ticketNo,
      l.deptCode ? `${l.description} (${l.deptCode})` : l.description,
      l.quantityText,
      l.billableQty,
      l.unitLabel,
      l.discountPct / 100,
      rupees(l.listRatePaise),
      rupees(l.finalRatePaise),
      rupees(l.taxablePaise),
      rupees(doc.intraState ? l.cgstPaise : l.igstPaise),
      doc.intraState ? rupees(l.sgstPaise) : null,
      rupees(l.totalPaise),
    ]);
    r.alignment = { wrapText: true, vertical: "top" };
    r.getCell(7).numFmt = "0.##%";
    for (const c of [8, 9, 10, 11, 12, 13]) r.getCell(c).numFmt = MONEY;
  });

  const t = doc.totals;
  const totalRow = (label: string, paise: number, bold = false) => {
    const r = ws.addRow(["", "", "", "", "", "", "", "", "", "", "", label, rupees(paise)]);
    r.getCell(12).font = { bold };
    r.getCell(13).font = { bold };
    r.getCell(13).numFmt = MONEY;
    return r;
  };
  ws.addRow([]);
  if (t.discountPaise) totalRow("List amount", t.listPaise);
  if (t.discountPaise) totalRow("Less discount", -t.discountPaise);
  totalRow("Taxable value", t.taxablePaise, true);
  if (doc.intraState) {
    totalRow(`CGST ${doc.gstPct / 2}%`, t.cgstPaise);
    totalRow(`SGST ${doc.gstPct / 2}%`, t.sgstPaise);
  } else {
    totalRow(`IGST ${doc.gstPct}%`, t.igstPaise);
  }
  if (t.roundOffPaise) totalRow("Round off", t.roundOffPaise);
  const grand = totalRow("Invoice total", t.totalPaise, true);
  grand.getCell(13).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF4D6" } };

  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}

export const excelExporter: BillingExporter = {
  method: "EXCEL_MANUAL",
  label: "Download billing details (Excel)",
  async exportBilling(doc) {
    return {
      kind: "file",
      fileName: billingFileName(doc),
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bytes: await billingWorkbook(doc),
    };
  },
};
