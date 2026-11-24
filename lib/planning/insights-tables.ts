/** Each Planning Insights section as columns and rows, for "Download as Excel". Pure. */
import type { InsightTable } from "@/lib/inventory/insights-tables";
import type { PlanningInsights } from "@/lib/planning-insights";

export const PLANNING_SECTIONS = ["use", "waiting", "quoted", "on-time", "not-available", "earnings"] as const;
export type PlanningSection = (typeof PLANNING_SECTIONS)[number];

const rs = (paise: number | null) => (paise == null ? null : paise / 100);
const h1 = (v: number) => Math.round(v * 10) / 10;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthName = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const frac = (v: number | null) => (v == null ? null : Math.round(v * 10) / 1000);
const BLOCK_NAMES = {
  MAINTENANCE: "Maintenance",
  CALIBRATION: "Calibration",
  BREAKDOWN: "Breakdown",
  INTERNAL: "Internal work",
  OTHER: "Other",
} as const;

export function planningTable(section: PlanningSection, d: PlanningInsights): InsightTable {
  switch (section) {
    case "use":
      return {
        title: "Machine use",
        columns: [
          { header: "Machine", width: 36 },
          { header: "Dept.", width: 8 },
          { header: "Available hours", width: 12, fmt: "qty" },
          { header: "Blocked hours", width: 12, fmt: "qty" },
          { header: "Booked hours", width: 12, fmt: "qty" },
          { header: "Booked %", width: 10, fmt: "pct" },
          { header: "Actual running hours", width: 12, fmt: "qty" },
          { header: "Actual %", width: 10, fmt: "pct" },
          { header: "Booked % next 2 weeks", width: 12, fmt: "pct" },
        ],
        rows: d.use.map((m) => [m.name, m.deptCode, h1(m.availableHours), h1(m.blockedHours), h1(m.bookedHours), frac(m.bookedPct), h1(m.actualHours), frac(m.actualPct), frac(m.nextBookedPct)]),
      };
    case "waiting":
      return {
        title: "Work waiting",
        columns: [
          { header: "Department", width: 34 },
          { header: "Hours still to book", width: 14, fmt: "qty" },
          { header: "Booked hours to come", width: 14, fmt: "qty" },
          { header: "Total hours", width: 12, fmt: "qty" },
          { header: "Machine hours per working day", width: 14, fmt: "qty" },
          { header: "Working days of work", width: 12, fmt: "qty" },
          { header: "Jobs with no time set", width: 12, fmt: "int" },
        ],
        rows: d.waiting.map((w) => [`${w.deptCode}: ${w.name}`, h1(w.toBookHours), h1(w.bookedHours), h1(w.hours), h1(w.capacityPerDay), w.days, w.noTimeJobs]),
      };
    case "quoted":
      return {
        title: "Quoted vs actual hours",
        columns: [
          { header: "Ticket", width: 22 },
          { header: "Customer", width: 30 },
          { header: "Service", width: 34 },
          { header: "Dept.", width: 8 },
          { header: "Done on", width: 12, fmt: "date" },
          { header: "Quoted hours", width: 10, fmt: "qty" },
          { header: "Actual hours", width: 10, fmt: "qty" },
          { header: "Extra hours", width: 10, fmt: "qty" },
          { header: "Over by %", width: 10, fmt: "pct" },
          { header: "Rate per hour (₹)", width: 12, fmt: "money" },
          { header: "Value of extra hours (₹)", width: 14, fmt: "money" },
        ],
        rows: d.quoted.flagged.map((j) => [
          j.ticketNo,
          j.company,
          j.service,
          j.deptCode,
          j.doneDate,
          h1(j.quotedHours),
          h1(j.actualHours),
          h1(j.extraHours),
          frac(j.overPct),
          rs(j.ratePaise),
          rs(j.extraPaise),
        ]),
      };
    case "on-time":
      return {
        title: "On-time delivery",
        columns: [
          { header: "Department", width: 30 },
          ...d.onTime.months.map((m) => ({
            header: `${monthName(m.month)} on time %`,
            width: 12,
            fmt: "pct" as const,
          })),
          { header: "Jobs done", width: 10, fmt: "int" },
          { header: "On time", width: 10, fmt: "int" },
          { header: "On time %", width: 10, fmt: "pct" },
        ],
        rows: [
          ...d.onTime.depts.map((r) => [`${r.dept}: ${d.deptName[r.dept] ?? r.dept}`, ...r.cells.map((c) => frac(c.pct)), r.overall.done, r.overall.onTime, frac(r.overall.pct)]),
          ["All departments", ...d.onTime.months.map((c) => frac(c.pct)), d.onTime.overall.done, d.onTime.overall.onTime, frac(d.onTime.overall.pct)],
        ],
        more: [
          {
            title: "Late jobs",
            columns: [
              { header: "Ticket", width: 22 },
              { header: "Customer", width: 30 },
              { header: "Service", width: 34 },
              { header: "Dept.", width: 8 },
              { header: "Promised", width: 12, fmt: "date" },
              { header: "Done on", width: 12, fmt: "date" },
              { header: "Days late", width: 10, fmt: "int" },
            ],
            rows: d.onTime.late.map((j) => [j.ticketNo, j.company, j.service, j.deptCode, j.promised, j.done ?? "Not done yet", j.daysLate]),
          },
        ],
      };
    case "not-available":
      return {
        title: "Machine not available",
        columns: [
          { header: "Machine", width: 36 },
          { header: "Month", width: 10 },
          ...d.blocked.types.map((t) => ({
            header: `${BLOCK_NAMES[t]} hours`,
            width: 12,
            fmt: "qty" as const,
          })),
          { header: "Total hours", width: 12, fmt: "qty" },
        ],
        rows: d.blocked.rows.map((r) => [r.name, monthName(r.month), ...d.blocked.types.map((t) => h1(r.hours[t])), h1(r.total)]),
      };
    case "earnings":
      return {
        title: "Earnings per machine hour",
        columns: [
          { header: "Machine", width: 36 },
          { header: "Dept.", width: 8 },
          { header: "Jobs done", width: 10, fmt: "int" },
          { header: "Running hours", width: 12, fmt: "qty" },
          { header: "Value before GST (₹)", width: 16, fmt: "money" },
          { header: "Earnings per hour (₹)", width: 14, fmt: "money" },
        ],
        rows: d.earnings.map((e) => [e.name, e.deptCode, e.jobs, h1(e.hours), rs(e.valuePaise), rs(e.perHourPaise)]),
      };
  }
}
