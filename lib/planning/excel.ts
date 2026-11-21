/** Planning Excel files. Server only (exceljs). */
import "server-only";
import ExcelJS from "exceljs";
import type { JobRow } from "@/lib/planning-data";
import { istDate, istMinutes, hhmm } from "./hours";
import { JOB_STATUS_UI } from "./job-status";

const dt = (d: Date | null) => (d ? `${istDate(d).split("-").reverse().join("/")} ${hhmm(Math.round(istMinutes(d)))}` : "");

/** The jobs list as shown (with its filters). */
export async function jobsWorkbook(rows: JobRow[], note: string): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "AutoCluster ERP";
  const ws = wb.addWorksheet("Jobs");
  ws.addRow(["Jobs"]).font = { bold: true, size: 13 };
  ws.addRow([note]).font = { color: { argb: "FF6B7280" } };
  ws.addRow([]);
  const head = ws.addRow(["Ticket no.", "Customer", "Service", "Dept.", "Status", "Priority", "Machine(s)", "Planned start", "Planned end", "Promised date", "Time needed (h)", "Planned (h)", "Actual (h)", "Quoted (h)", "Operator", "Late"]);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B1F3A" } };
  head.alignment = { vertical: "middle", wrapText: true };
  [20, 30, 30, 8, 12, 10, 30, 17, 17, 13, 10, 10, 10, 10, 18, 8].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  for (const j of rows) {
    const r = ws.addRow([
      j.ticketNo,
      j.company,
      j.service,
      j.deptCode ?? "",
      JOB_STATUS_UI[j.status].label,
      j.priority === "URGENT" ? "Urgent" : "Normal",
      j.machines.join(", "),
      dt(j.plannedStart),
      dt(j.plannedEnd),
      j.promisedDate ? new Date(`${j.promisedDate}T00:00:00Z`) : null,
      j.hoursNeeded,
      j.plannedHours,
      Math.round(j.actualHours * 100) / 100,
      j.quotedHours,
      j.operator ?? "",
      j.late ? "Yes" : "",
    ]);
    r.getCell(10).numFmt = "dd/mm/yyyy";
    for (const c of [11, 12, 13, 14]) r.getCell(c).numFmt = "0.0#";
  }
  ws.views = [{ state: "frozen", ySplit: 4 }];
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
