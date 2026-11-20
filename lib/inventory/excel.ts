/** Inventory Excel files. Server only (exceljs). */
import "server-only";
import ExcelJS from "exceljs";
import type { InvDocRow, ItemHistoryRow, OrderListData } from "@/lib/inventory-data";
import { formatDate } from "@/lib/format";
import { orderQtyText } from "./reorder";

const MONEY = '"₹"#,##,##0.00;-"₹"#,##,##0.00';
const RATE = '"₹"#,##0.0000';
const QTY = "#,##,##0.###";
const TYPE = { IN: "Stock received", OUT: "Stock used", ADJ: "Stock adjusted" } as const;
const asDate = (iso: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`) : null);

function header(ws: ExcelJS.Worksheet) {
  const r = ws.getRow(1);
  r.font = { bold: true, color: { argb: "FFFFFFFF" } };
  r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B1F3A" } };
  r.height = 28;
  r.alignment = { vertical: "middle", wrapText: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

/** One row per line, for the records shown on Stock in & out (with its filters). */
export async function movementsWorkbook(
  docs: InvDocRow[],
  lines: { document_id: string; item: string; code: string; unit: string; batch_no: string | null; qty_in: string; qty_out: string; unit_cost: string; value: string; reason: string | null }[],
  note: string,
): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "AutoCluster ERP";
  const ws = wb.addWorksheet("Stock in and out");
  ws.columns = [
    { header: "Date", key: "date", width: 12, style: { numFmt: "dd/mm/yyyy" } },
    { header: "Record no.", key: "docNo", width: 22 },
    { header: "Type", key: "type", width: 16 },
    { header: "Supplier / job / purpose", key: "what", width: 32 },
    { header: "Item code", key: "code", width: 12 },
    { header: "Item", key: "item", width: 30 },
    { header: "Batch", key: "batch", width: 14 },
    { header: "In", key: "in", width: 12, style: { numFmt: QTY } },
    { header: "Out", key: "out", width: 12, style: { numFmt: QTY } },
    { header: "Unit", key: "unit", width: 8 },
    { header: "Cost per unit (₹)", key: "cost", width: 14, style: { numFmt: RATE } },
    { header: "Value (₹)", key: "value", width: 14, style: { numFmt: MONEY } },
    { header: "Reason", key: "reason", width: 16 },
    { header: "Done by", key: "doneBy", width: 16 },
    { header: "Note", key: "note", width: 36 },
    { header: "Reversal", key: "rev", width: 24 },
  ];
  header(ws);
  const byDoc = new Map(docs.map((d) => [d.id, d]));
  for (const l of lines) {
    const d = byDoc.get(l.document_id);
    if (!d) continue;
    ws.addRow({
      date: asDate(d.docDate),
      docNo: d.docNo,
      type: TYPE[d.type],
      what: d.type === "IN" ? [d.supplier, d.billNo ? `bill ${d.billNo}` : null].filter(Boolean).join(", ") : d.ticketNo ? `Job ${d.ticketNo}` : (d.purpose ?? ""),
      code: l.code,
      item: l.item,
      batch: l.batch_no ?? "",
      in: Number(l.qty_in) || null,
      out: Number(l.qty_out) || null,
      unit: l.unit,
      cost: Number(l.unit_cost),
      value: Number(l.value) / 100,
      reason: l.reason ?? "",
      doneBy: d.doneBy ?? "",
      note: d.note ?? "",
      rev: d.reverses ? `Reverses ${d.reverses}` : d.reversedBy ? `Reversed by ${d.reversedBy}` : "",
    });
  }
  ws.addRow([]);
  ws.addRow([note]).font = { italic: true, color: { argb: "FF6B7280" } };
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

/** One item's stock history with the running balance, oldest first. */
export async function itemHistoryWorkbook(item: { name: string; code: string; unit: string }, rows: ItemHistoryRow[]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "AutoCluster ERP";
  const ws = wb.addWorksheet("Stock history");
  ws.columns = [
    { header: "Date", key: "date", width: 12, style: { numFmt: "dd/mm/yyyy" } },
    { header: "Record no.", key: "docNo", width: 22 },
    { header: "Type", key: "type", width: 16 },
    { header: "For / from", key: "what", width: 34 },
    { header: "Batch", key: "batch", width: 14 },
    { header: `In (${item.unit})`, key: "in", width: 12, style: { numFmt: QTY } },
    { header: `Out (${item.unit})`, key: "out", width: 12, style: { numFmt: QTY } },
    { header: `Balance (${item.unit})`, key: "bal", width: 14, style: { numFmt: QTY } },
    { header: "Cost per unit (₹)", key: "cost", width: 14, style: { numFmt: RATE } },
    { header: "Value (₹)", key: "value", width: 14, style: { numFmt: MONEY } },
    { header: "Done by", key: "doneBy", width: 16 },
    { header: "Note", key: "note", width: 36 },
  ];
  header(ws);
  for (const r of [...rows].reverse()) {
    ws.addRow({
      date: asDate(r.docDate),
      docNo: r.docNo,
      type: r.isReversal ? `Reversal (${TYPE[r.type].toLowerCase()})` : r.reason === "Opening stock" ? "Opening stock" : TYPE[r.type],
      what: r.type === "IN" ? [r.supplier, r.billNo ? `bill ${r.billNo}` : null].filter(Boolean).join(", ") : r.type === "OUT" ? (r.ticketNo ? `Job ${r.ticketNo}` : (r.purpose ?? "")) : (r.reason ?? ""),
      batch: r.batchNo ?? "",
      in: Number(r.qtyIn) || null,
      out: Number(r.qtyOut) || null,
      bal: Number(r.balanceAfter),
      cost: Number(r.unitCost),
      value: r.valuePaise / 100,
      doneBy: r.doneBy ?? "",
      note: [r.note, r.isReversed ? "(reversed later)" : null].filter(Boolean).join(" "),
    });
  }
  ws.addRow([]);
  ws.addRow([`${item.name} (${item.code})`]).font = { italic: true, color: { argb: "FF6B7280" } };
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

/** The order list for a supplier, with ACDRI's details on top. */
export async function orderListWorkbook(data: OrderListData): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = data.org.name;
  const ws = wb.addWorksheet("Order list");
  ws.columns = [{ width: 6 }, { width: 12 }, { width: 36 }, { width: 14 }, { width: 8 }, { width: 34 }, { width: 18 }, { width: 18 }];
  ws.addRow([data.org.name]).font = { bold: true, size: 14, color: { argb: "FF0B1F3A" } };
  ws.addRow([data.org.address]);
  ws.addRow([`GSTIN ${data.org.gstin} · ${data.org.phone} · ${data.org.email}`]);
  ws.addRow([]);
  ws.addRow(["Order list", "", "", "", "", "Date", formatDate(data.today)]).font = { bold: true };
  if (data.supplier) {
    ws.addRow(["To", "", data.supplier.name]).font = { bold: true };
    if (data.supplier.contactName) ws.addRow(["", "", `Kind attention: ${data.supplier.contactName}`]);
    const contact = [data.supplier.phone, data.supplier.email].filter(Boolean).join(" · ");
    if (contact) ws.addRow(["", "", contact]);
  }
  ws.addRow([]);
  const head = ws.addRow(["Sr.", "Our code", "Item", "Quantity", "Unit", "Quantity (in packs)", "Last rate, before GST (₹)", "Estimated amount (₹)"]);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B1F3A" } };
  head.alignment = { vertical: "middle", wrapText: true };
  head.height = 30;
  const first = head.number + 1;
  data.items.forEach((it, i) => {
    const r = ws.addRow([i + 1, it.code, it.name, Number(it.qty), it.unit, orderQtyText({ name: it.name, qty: it.qty, unit: it.unit, packName: it.pack_name, packSize: it.pack_size }), it.rate ? Number(it.rate) : null, it.valuePaise != null ? it.valuePaise / 100 : null]);
    r.getCell(4).numFmt = QTY;
    r.getCell(7).numFmt = RATE;
    r.getCell(8).numFmt = MONEY;
  });
  const total = ws.addRow(["", "", "Estimated total", "", "", "", "", { formula: `SUM(H${first}:H${first + data.items.length - 1})` }]);
  total.font = { bold: true };
  total.getCell(8).numFmt = MONEY;
  ws.addRow([]);
  ws.addRow(["", "", "Last rates are for reference only. Kindly confirm the rates and the delivery date."]);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
