/** Inventory Excel files. Server only (exceljs). */
import "server-only";
import ExcelJS from "exceljs";
import type { InvDocRow, ItemHistoryRow, OrderListData } from "@/lib/inventory-data";
import { formatDate } from "@/lib/format";
import { orderQtyText } from "./reorder";
import type { Col, InsightTable } from "./insights-tables";
import { UserFacingError } from "@/db/quote-writer";
import { IMPORT_TOO_BIG, MAX_IMPORT_BYTES } from "@/lib/crm/import";
import { ITEM_IMPORT_COLUMNS, MAX_ITEM_IMPORT_ROWS, isExampleItemRow, itemColumnForHeader, type CheckedItemRow, type ItemImportKey, type ItemImportLists, type ItemRawRow } from "./import";

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
  wb.creator = "ERPOne";
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
  wb.creator = "ERPOne";
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

// ---- Import items from Excel -----------------------------------------------------------------------

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B1F3A" } };
const OPENING_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF14532D" } };

function importHeader(ws: ExcelJS.Worksheet) {
  const r = ws.getRow(1);
  r.font = { bold: true, color: { argb: "FFFFFFFF" } };
  r.fill = HEADER_FILL;
  r.alignment = { vertical: "middle", wrapText: true };
  r.height = 34;
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

/** The template: the right columns, one example row, a "How to fill" sheet and a "Lists" sheet. */
export async function itemImportTemplate(lists: Pick<ItemImportLists, "categories" | "units" | "suppliers" | "departments">): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ERPOne";
  const ws = wb.addWorksheet("Items");
  ws.columns = ITEM_IMPORT_COLUMNS.map((c) => ({ header: c.required ? `${c.header} *` : c.header, key: c.key, width: c.width }));
  importHeader(ws);
  // The opening stock columns in green, so it's clear they are a separate, optional part.
  ITEM_IMPORT_COLUMNS.forEach((c, i) => {
    if (["openingQty", "openingRate", "batchNo", "expiryDate"].includes(c.key)) ws.getRow(1).getCell(i + 1).fill = OPENING_FILL;
  });
  ws.addRow(Object.fromEntries(ITEM_IMPORT_COLUMNS.map((c) => [c.key, c.example])));
  ws.getRow(2).font = { italic: true, color: { argb: "FF6B7280" } };
  for (const key of ["code", "hsnCode", "batchNo", "expiryDate"]) ws.getColumn(ITEM_IMPORT_COLUMNS.findIndex((c) => c.key === key) + 1).numFmt = "@";

  const help = wb.addWorksheet("How to fill");
  help.columns = [{ width: 8 }, { width: 100 }];
  const lines: [string, string][] = [
    ["How to use this file", ""],
    ["1", "Fill one item per row on the “Items” sheet, starting on row 3. The grey example row is skipped if left in."],
    ["2", "Columns marked * are required. Leave Item code empty to get the next number (ITM-0001, ...)."],
    ["3", "Category, Unit and Preferred supplier must match the names on the “Lists” sheet. Unknown names are not created; they show as problems."],
    ["4", "Departments: codes separated by commas, e.g. RPT, ENV. Track batches: Yes for resins, powders and chemicals."],
    ["5", "Opening stock (green columns, optional): the quantity on the shelf now, in the item's unit, and the rate per unit before GST, e.g. 4.50."],
    ["6", "Items that track batches need a batch number and an expiry date (e.g. 31/03/2027) for their opening stock. One batch per row."],
    ["", "Several batches of one item: put the item on the first row as usual, then repeat the item name on the next rows with only the opening stock columns filled. Other details on those rows can be left empty; if filled, they must match the first row."],
    ["7", `Up to ${MAX_ITEM_IMPORT_ROWS} rows per file. All opening stock is saved as one Stock adjusted record, labelled “Opening stock”.`],
  ];
  for (const l of lines) help.addRow(l);
  help.getRow(1).font = { bold: true, size: 14 };
  help.getColumn(2).alignment = { wrapText: true, vertical: "top" };

  const ls = wb.addWorksheet("Lists");
  const cols: [string, string[]][] = [
    ["Category", lists.categories.map((c) => c.name)],
    ["Unit", lists.units.map((u) => u.name)],
    ["Preferred supplier", lists.suppliers.map((s) => s.name)],
    ["Departments", lists.departments.map((d) => `${d.code} (${d.name})`)],
    ["Track batches", ["Yes", "No"]],
  ];
  ls.columns = cols.map(([h]) => ({ header: h, width: 28 }));
  importHeader(ls);
  const longest = Math.max(...cols.map(([, v]) => v.length));
  for (let i = 0; i < longest; i++) ls.addRow(cols.map(([, v]) => v[i] ?? ""));
  const dropdown = (key: ItemImportKey, listCol: string, n: number) => {
    if (!n) return;
    const col = ITEM_IMPORT_COLUMNS.findIndex((c) => c.key === key) + 1;
    for (let r = 2; r <= 301; r++) ws.getCell(r, col).dataValidation = { type: "list", allowBlank: true, showErrorMessage: false, formulae: [`Lists!$${listCol}$2:$${listCol}$${n + 1}`] };
  };
  dropdown("category", "A", cols[0][1].length);
  dropdown("unit", "B", cols[1][1].length);
  dropdown("supplier", "C", cols[2][1].length);
  dropdown("trackBatches", "E", 2);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("text" in v) return String(v.text);
    if ("result" in v) return v.result instanceof Date ? v.result.toISOString().slice(0, 10) : String(v.result ?? "");
    if ("error" in v) return "";
  }
  return String(v);
}

/** Reads the "Items" sheet (or the first sheet). Row numbers are the Excel row numbers. */
export async function readItemImportFile(bytes: Uint8Array): Promise<{ rows: { rowNo: number; raw: ItemRawRow }[]; skippedExample: boolean }> {
  if (bytes.byteLength > MAX_IMPORT_BYTES) throw new UserFacingError(IMPORT_TOO_BIG);
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  } catch {
    throw new UserFacingError("This file couldn't be read. Please upload the Excel template (.xlsx), filled in and saved.");
  }
  const ws = wb.getWorksheet("Items") ?? wb.worksheets[0];
  if (!ws) throw new UserFacingError("The file has no sheets. Please use the template.");
  const map = new Map<number, ItemImportKey>();
  ws.getRow(1).eachCell((cell, col) => {
    const key = itemColumnForHeader(cellText(cell.value));
    if (key && ![...map.values()].includes(key)) map.set(col, key);
  });
  const missing = ITEM_IMPORT_COLUMNS.filter((c) => c.required && ![...map.values()].includes(c.key)).map((c) => c.header);
  if (missing.length) throw new UserFacingError(`Some required columns are missing: ${missing.join(", ")}. Please use the template.`);
  const rows: { rowNo: number; raw: ItemRawRow }[] = [];
  let skippedExample = false;
  ws.eachRow({ includeEmpty: false }, (row, rowNo) => {
    if (rowNo === 1) return;
    const raw: ItemRawRow = {};
    for (const [col, key] of map) {
      const t = cellText(row.getCell(col).value).trim();
      if (t) raw[key] = t;
    }
    if (!Object.keys(raw).length) return;
    if (isExampleItemRow(raw)) {
      skippedExample = true;
      return;
    }
    rows.push({ rowNo, raw });
  });
  if (!rows.length) throw new UserFacingError("No items were found in the file. Fill them in from row 3 of the “Items” sheet.");
  if (rows.length > MAX_ITEM_IMPORT_ROWS) throw new UserFacingError(`The file has ${rows.length} rows. Please import at most ${MAX_ITEM_IMPORT_ROWS} at a time.`);
  return { rows, skippedExample };
}

/** Problem rows with their original values and the problems listed, to fix and upload again. */
export async function itemProblemRowsWorkbook(rows: CheckedItemRow[]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ERPOne";
  const ws = wb.addWorksheet("Items");
  ws.columns = [
    ...ITEM_IMPORT_COLUMNS.map((c) => ({ header: c.required ? `${c.header} *` : c.header, key: c.key, width: c.width })),
    { header: "Problems (fix them; this column is ignored on import)", key: "__problems", width: 70 },
  ];
  importHeader(ws);
  for (const r of rows) {
    const row = ws.addRow({ ...r.raw, __problems: r.problems.map((p) => p.replace(/^Row \d+: /, `Was row ${r.rowNo}: `)).join("\n") });
    row.getCell("__problems").font = { color: { argb: "FFB91C1C" } };
    row.getCell("__problems").alignment = { wrapText: true, vertical: "top" };
  }
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

// ---- Insights tables -------------------------------------------------------------------------------

/** One Insights table as a workbook, with the period and department on top. */
export async function insightTableWorkbook(t: InsightTable, note: string): Promise<Uint8Array> {
  const FMT: Record<NonNullable<Col["fmt"]>, string> = { money: MONEY, pct: "0.0%", qty: QTY, rate: RATE, date: "dd/mm/yyyy", int: "#,##0" };
  const wb = new ExcelJS.Workbook();
  wb.creator = "ERPOne";
  const ws = wb.addWorksheet(t.title.slice(0, 31));
  ws.addRow([t.title]).font = { bold: true, size: 13 };
  ws.addRow([note]).font = { color: { argb: "FF6B7280" } };
  ws.addRow([]);
  const isDate = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v);
  const widths: number[] = [];
  const write = (tb: InsightTable) => {
    const head = ws.addRow(tb.columns.map((c) => c.header));
    head.font = { bold: true, color: { argb: "FFFFFFFF" } };
    head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B1F3A" } };
    head.alignment = { vertical: "middle", wrapText: true };
    head.height = 32;
    tb.columns.forEach((c, i) => (widths[i] = Math.max(widths[i] ?? 0, c.width)));
    for (const r of tb.rows) {
      const row = ws.addRow(r.map((v, i) => (tb.columns[i]?.fmt === "date" && isDate(v) ? asDate(v as string) : v)));
      tb.columns.forEach((c, i) => {
        if (c.fmt && typeof r[i] !== "string") row.getCell(i + 1).numFmt = FMT[c.fmt];
        if (c.fmt === "date" && isDate(r[i])) row.getCell(i + 1).numFmt = FMT.date;
      });
    }
  };
  write(t);
  for (const more of t.more ?? []) {
    ws.addRow([]);
    ws.addRow([more.title]).font = { bold: true, size: 12 };
    write(more);
  }
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.views = [{ state: "frozen", ySplit: 4 }];
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
