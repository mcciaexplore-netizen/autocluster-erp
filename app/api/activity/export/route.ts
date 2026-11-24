/** "Download as Excel" on the Activity log: the entries matching the filters (up to 5,000). */
import ExcelJS from "exceljs";
import { activityFiltersFromParams, listActivity } from "@/lib/activity-data";
import { routeAllow } from "@/lib/auth/guard";
import { todayInIndia } from "@/lib/tickets";

const when = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });

export async function GET(request: Request) {
  const gate = await routeAllow("users.manage");
  if (gate.denied) return gate.denied;
  const params = new URL(request.url).searchParams;
  const { rows } = await listActivity({ ...activityFiltersFromParams(Object.fromEntries(params.entries())), limit: 5000 });
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Activity log");
  ws.columns = [
    { header: "When (India time)", key: "at", width: 20 },
    { header: "Who", key: "who", width: 22 },
    { header: "For", key: "for", width: 22 },
    { header: "Area", key: "area", width: 14 },
    { header: "What", key: "what", width: 70 },
    { header: "Record", key: "record", width: 22 },
    { header: "IP address", key: "ip", width: 18 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  for (const r of rows) ws.addRow({ at: when.format(new Date(r.at)), who: r.who, for: r.forName ?? "", area: r.area, what: r.summary, record: r.record ?? "", ip: r.ip ?? "" });
  const today = todayInIndia();
  return new Response(new Blob([(await wb.xlsx.writeBuffer()) as BlobPart]), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Activity-log-${today}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
