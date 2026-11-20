/** Inventory Excel files. Server only (exceljs). */
import "server-only";
import ExcelJS from "exceljs";
import type { InvDocRow, ItemHistoryRow } from "@/lib/inventory-data";

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
      type: r.isReversal ? `Reversal (${TYPE[r.type].toLowerCase()})` : TYPE[r.type],
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
