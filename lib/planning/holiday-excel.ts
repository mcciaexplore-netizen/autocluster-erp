/** Holidays from Excel (Settings > Planning). Server only (exceljs). */
import "server-only";
import ExcelJS from "exceljs";
import { UserFacingError } from "@/db/quote-writer";
import { parseImportDate } from "@/lib/crm/import";

export async function holidaysTemplate(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "AutoCluster ERP";
  const ws = wb.addWorksheet("Holidays");
  ws.columns = [
    { header: "Date", key: "date", width: 14 },
    { header: "Holiday", key: "name", width: 32 },
  ];
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B1F3A" } };
  ws.getColumn(1).numFmt = "@";
  ws.addRow({ date: "25/12/2026", name: "Christmas" });
  ws.addRow({ date: "26/01/2027", name: "Republic Day" });
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("text" in v) return String(v.text);
    if ("result" in v) return v.result instanceof Date ? v.result.toISOString().slice(0, 10) : String(v.result ?? "");
  }
  return String(v);
}

/** Reads Date + Holiday columns from the first sheet. Problems are plain sentences starting "Row N:". */
export async function readHolidaysFile(bytes: Uint8Array): Promise<{ rows: { date: string; name: string }[]; problems: string[] }> {
  if (bytes.byteLength > 500 * 1024) throw new UserFacingError("The file is larger than 500 KB. Please keep only the holidays sheet.");
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  } catch {
    throw new UserFacingError("This file couldn't be read. Please upload an Excel file (.xlsx) with Date and Holiday columns.");
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new UserFacingError("The file has no sheets.");
  const rows: { date: string; name: string }[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    const a = cellText(row.getCell(1).value).trim();
    const b = cellText(row.getCell(2).value).trim();
    if (n === 1 && /date/i.test(a)) return; // header
    if (!a && !b) return;
    const date = parseImportDate(a || null);
    if (!date) return void problems.push(`Row ${n}: “${a}” should be a date, e.g. 25/12/2026.`);
    if (!b) return void problems.push(`Row ${n}: the holiday name is missing.`);
    if (seen.has(date)) return void problems.push(`Row ${n}: ${a} is listed twice.`);
    seen.add(date);
    rows.push({ date, name: b });
  });
  if (!rows.length && !problems.length) throw new UserFacingError("No holidays were found. Put the dates in column A and the names in column B.");
  if (rows.length > 400) throw new UserFacingError("Please import at most 400 holidays at a time.");
  return { rows, problems };
}
