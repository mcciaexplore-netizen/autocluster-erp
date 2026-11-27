/**
 * CRM Excel files: the import template, reading an uploaded file, the list export,
 * and the "problem rows" file. Server only (uses exceljs).
 */
import "server-only";
import ExcelJS from "exceljs";
import { UserFacingError } from "@/db/quote-writer";
import type { BoardLead, BoardStage } from "@/lib/crm-data";
import { ACTIVITY_TYPES } from "./leads";
import { columnForHeader, IMPORT_COLUMNS, IMPORT_TOO_BIG, MAX_IMPORT_BYTES, isExampleRow, MAX_IMPORT_ROWS, type CheckedRow, type ImportKey, type ImportLists, type RawRow } from "./import";

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B1F3A" } };
const MONEY = '"₹"#,##,##0;-"₹"#,##,##0';
const MAX_BYTES = MAX_IMPORT_BYTES;

async function toBytes(wb: ExcelJS.Workbook) {
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

function headerRow(ws: ExcelJS.Worksheet) {
  const r = ws.getRow(1);
  r.font = { bold: true, color: { argb: "FFFFFFFF" } };
  r.fill = HEADER_FILL;
  r.alignment = { vertical: "middle", wrapText: true };
  r.height = 32;
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

/** The template: the right columns, one example row, and a Lists sheet with the allowed values. */
export async function importTemplate(lists: ImportLists): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ERPOne";
  const ws = wb.addWorksheet("Enquiries");
  ws.columns = IMPORT_COLUMNS.map((c) => ({ header: c.required ? `${c.header} *` : c.header, key: c.key, width: c.width }));
  headerRow(ws);
  ws.addRow(Object.fromEntries(IMPORT_COLUMNS.map((c) => [c.key, c.example])));
  ws.getRow(2).font = { italic: true, color: { argb: "FF6B7280" } };
  // Mobile numbers and IDs stay as text (Excel would otherwise drop digits or change them).
  for (const key of ["phone", "mcciaMembershipId"]) {
    const col = IMPORT_COLUMNS.findIndex((c) => c.key === key);
    if (col >= 0) ws.getColumn(col + 1).numFmt = "@";
  }

  const help = wb.addWorksheet("How to fill");
  help.columns = [{ width: 26 }, { width: 90 }];
  const lines: [string, string][] = [
    ["How to use this file", ""],
    ["1", "Fill one enquiry per row on the “Enquiries” sheet, starting on row 3. You can delete the grey example row (it is skipped if left in)."],
    ["2", "Columns marked * are required. Each row also needs a Mobile or an Email."],
    ["3", "Source, Stage, Assigned to and Tags must match the names on the “Lists” sheet exactly. Unknown names are not created; they show as problems."],
    ["4", "Departments: codes separated by commas, e.g. RPT, RPL. Several tags: separate them with commas."],
    ["5", "Dates like 31/12/2026. Amounts in rupees, e.g. 50000. Priority 0 to 3."],
    ["6", `Up to ${MAX_IMPORT_ROWS} rows per file. Save as .xlsx, then upload it in CRM > Import enquiries.`],
  ];
  for (const l of lines) help.addRow(l);
  help.getRow(1).font = { bold: true, size: 14 };
  help.getColumn(2).alignment = { wrapText: true, vertical: "top" };

  const ls = wb.addWorksheet("Lists");
  const cols: [string, string[]][] = [
    ["Source", lists.sources.map((s) => s.name)],
    ["Stage", lists.stages.filter((s) => s.type !== "LOST").map((s) => s.name)],
    ["Assigned to", lists.team.map((t) => t.name)],
    ["Tags", lists.tags.map((t) => t.name)],
    ["Departments", lists.departments.map((d) => `${d.code} (${d.name})`)],
    ["Company category", ["OEM", "Tier 1", "Tier 2", "MSME"]],
  ];
  ls.columns = cols.map(([h]) => ({ header: h, width: 26 }));
  headerRow(ls);
  const longest = Math.max(...cols.map(([, v]) => v.length));
  for (let i = 0; i < longest; i++) ls.addRow(cols.map(([, v]) => v[i] ?? ""));

  // Dropdowns for Source and Stage on the first rows (typing is still allowed).
  const dropdown = (key: ImportKey, listCol: string, n: number) => {
    if (!n) return;
    const col = IMPORT_COLUMNS.findIndex((c) => c.key === key) + 1;
    for (let r = 2; r <= 301; r++) {
      ws.getCell(r, col).dataValidation = { type: "list", allowBlank: true, showErrorMessage: false, formulae: [`Lists!$${listCol}$2:$${listCol}$${n + 1}`] };
    }
  };
  dropdown("source", "A", cols[0][1].length);
  dropdown("stage", "B", cols[1][1].length);
  dropdown("assignedTo", "C", cols[2][1].length);
  return toBytes(wb);
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

/** Reads the first sheet of an uploaded .xlsx. Row numbers are the Excel row numbers. */
export async function readImportFile(bytes: Uint8Array): Promise<{ rows: { rowNo: number; raw: RawRow }[]; skippedExample: boolean }> {
  if (bytes.byteLength > MAX_BYTES) throw new UserFacingError(IMPORT_TOO_BIG);
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  } catch {
    throw new UserFacingError("This file couldn't be read. Please upload the Excel template (.xlsx), filled in and saved.");
  }
  const ws = wb.getWorksheet("Enquiries") ?? wb.worksheets[0];
  if (!ws) throw new UserFacingError("The file has no sheets. Please use the template.");
  const header = ws.getRow(1);
  const map = new Map<number, ImportKey>();
  header.eachCell((cell, col) => {
    const key = columnForHeader(cellText(cell.value));
    if (key && ![...map.values()].includes(key)) map.set(col, key);
  });
  const missing = IMPORT_COLUMNS.filter((c) => c.required && ![...map.values()].includes(c.key)).map((c) => c.header);
  if (missing.length) throw new UserFacingError(`Some required columns are missing: ${missing.join(", ")}. Please use the template.`);

  const rows: { rowNo: number; raw: RawRow }[] = [];
  let skippedExample = false;
  ws.eachRow({ includeEmpty: false }, (row, rowNo) => {
    if (rowNo === 1) return;
    const raw: RawRow = {};
    for (const [col, key] of map) {
      const t = cellText(row.getCell(col).value).trim();
      if (t) raw[key] = t;
    }
    if (!Object.keys(raw).length) return;
    if (isExampleRow(raw)) {
      skippedExample = true;
      return;
    }
    rows.push({ rowNo, raw });
  });
  if (!rows.length) throw new UserFacingError("No enquiries were found in the file. Fill them in from row 3 of the “Enquiries” sheet.");
  if (rows.length > MAX_IMPORT_ROWS) throw new UserFacingError(`The file has ${rows.length} rows. Please import at most ${MAX_IMPORT_ROWS} at a time.`);
  return { rows, skippedExample };
}

/** Problem rows with their original values and the problems listed, to fix and upload again. */
export async function problemRowsWorkbook(rows: CheckedRow[]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ERPOne";
  const ws = wb.addWorksheet("Enquiries");
  ws.columns = [
    ...IMPORT_COLUMNS.map((c) => ({ header: c.required ? `${c.header} *` : c.header, key: c.key, width: c.width })),
    { header: "Problems (fix, then delete this column or leave it)", key: "__problems", width: 70 },
  ];
  headerRow(ws);
  for (const r of rows) {
    const row = ws.addRow({ ...r.raw, __problems: r.problems.map((p) => p.replace(/^Row \d+: /, `Was row ${r.rowNo}: `)).join("\n") });
    row.getCell("__problems").font = { color: { argb: "FFB91C1C" } };
    row.getCell("__problems").alignment = { wrapText: true, vertical: "top" };
  }
  return toBytes(wb);
}

/** "Download as Excel" from the list view: the rows shown, with the current filters and sort. */
export async function exportLeadsWorkbook(leads: BoardLead[], stages: BoardStage[], title: string): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ERPOne";
  const ws = wb.addWorksheet("Enquiries");
  ws.columns = [
    { header: "Enquiry no.", key: "leadNo", width: 22 },
    { header: "Title", key: "title", width: 36 },
    { header: "Company", key: "company", width: 30 },
    { header: "Contact", key: "contact", width: 20 },
    { header: "Mobile", key: "phone", width: 14 },
    { header: "Email", key: "email", width: 28 },
    { header: "Stage", key: "stage", width: 14 },
    { header: "Lost reason", key: "lost", width: 20 },
    { header: "Expected value (₹)", key: "value", width: 16, style: { numFmt: MONEY } },
    { header: "Expected close", key: "close", width: 14, style: { numFmt: "dd/mm/yyyy" } },
    { header: "Next activity", key: "activity", width: 22 },
    { header: "Activity due", key: "activityDue", width: 14, style: { numFmt: "dd/mm/yyyy" } },
    { header: "Assigned to", key: "assigned", width: 18 },
    { header: "Source", key: "source", width: 16 },
    { header: "Departments", key: "depts", width: 14 },
    { header: "Tags", key: "tags", width: 18 },
    { header: "Priority", key: "priority", width: 9 },
    { header: "Created", key: "created", width: 14, style: { numFmt: "dd/mm/yyyy" } },
  ];
  headerRow(ws);
  const stageName = new Map(stages.map((s) => [s.id, s.name]));
  const asDate = (iso: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`) : null);
  for (const l of leads) {
    ws.addRow({
      leadNo: l.leadNo,
      title: l.title,
      company: l.companyName,
      contact: l.contactName,
      phone: l.phone ?? "",
      email: l.email ?? "",
      stage: stageName.get(l.stageId) ?? "",
      lost: l.stageType === "LOST" ? (l.lostReason ?? "") : "",
      value: l.expectedValuePaise != null ? l.expectedValuePaise / 100 : null,
      close: asDate(l.expectedCloseDate),
      activity: l.nextActivity ? ACTIVITY_TYPES[l.nextActivity.type] : "None planned",
      activityDue: asDate(l.nextActivityDate),
      assigned: l.assignedToName ?? "",
      source: l.sourceName,
      depts: l.depts.join(", "),
      tags: l.tags.map((t) => t.name).join(", "),
      priority: l.priority,
      created: asDate(l.createdAt),
    });
  }
  ws.getColumn("phone").numFmt = "@";
  ws.addRow([]);
  ws.addRow([title]).font = { italic: true, color: { argb: "FF6B7280" } };
  return toBytes(wb);
}
