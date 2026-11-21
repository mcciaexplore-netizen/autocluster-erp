/** Each Insights table as columns and rows, for "Download as Excel". Pure. */
import type { Insights } from "@/lib/inventory-insights";

export const INSIGHT_SECTIONS = ["spend", "services", "items", "prices", "tied-up", "expiry", "running-out"] as const;
export type InsightSection = (typeof INSIGHT_SECTIONS)[number];

export type Col = { header: string; width: number; fmt?: "money" | "pct" | "qty" | "rate" | "date" | "int" };
export interface InsightTable {
  title: string;
  columns: Col[];
  rows: (string | number | null)[][];
  /** Further tables below the first one, on the same sheet. */
  more?: InsightTable[];
}

const rs = (paise: number) => paise / 100;
const p1 = (v: number | null) => (v == null ? null : Math.round(v * 10) / 1000); // as a fraction, 1 decimal

export function insightTable(section: InsightSection, d: Insights): InsightTable {
  switch (section) {
    case "spend":
      return {
        title: "Material spend by month",
        columns: [{ header: "Month", width: 12 }, ...d.spend.series.map((s) => ({ header: `${s.name} (₹)`, width: 14, fmt: "money" as const })), { header: "Total (₹)", width: 14, fmt: "money" }],
        rows: d.spend.rows.map((r) => [r.month, ...d.spend.series.map((s) => rs(r[s.key] ?? 0)), rs(d.spend.series.reduce((a, s) => a + (r[s.key] ?? 0), 0))]),
      };
    case "services":
      return {
        title: "Kept after materials, by service",
        columns: [
          { header: "Service", width: 34 },
          { header: "Dept.", width: 8 },
          { header: "Jobs", width: 8, fmt: "int" },
          { header: "Jobs with materials recorded", width: 14, fmt: "int" },
          { header: "Revenue before GST (₹)", width: 16, fmt: "money" },
          { header: "Material cost (₹)", width: 14, fmt: "money" },
          { header: "Kept (₹)", width: 14, fmt: "money" },
          { header: "Kept %", width: 10, fmt: "pct" },
          { header: "Materials share %", width: 12, fmt: "pct" },
        ],
        rows: [
          ...d.services.ranked.map((s) => [s.name, s.deptCode, s.jobs, s.jobsRecorded, rs(s.revenuePaise), rs(s.materialPaise), rs(s.keptPaise), p1(s.keptPct), p1(s.materialSharePct)]),
          ...d.services.leftOut.map((name) => [name, null, null, null, null, null, null, null, "No materials list (left out of the ranking)"]),
        ],
      };
    case "items":
      return {
        title: "Biggest-spend items",
        columns: [
          { header: "Item", width: 32 },
          { header: "Code", width: 12 },
          { header: "Value used (₹)", width: 14, fmt: "money" },
          { header: "Share %", width: 10, fmt: "pct" },
          { header: "Running %", width: 10, fmt: "pct" },
        ],
        rows: d.topItems.map((i) => [i.name, i.code, rs(i.valuePaise), p1(i.sharePct), p1(i.runningPct)]),
      };
    case "prices":
      return {
        title: "Price changes",
        columns: [
          { header: "Item", width: 30 },
          { header: "Old rate (₹)", width: 12, fmt: "rate" },
          { header: "Old rate date", width: 12, fmt: "date" },
          { header: "New rate (₹)", width: 12, fmt: "rate" },
          { header: "New rate date", width: 12, fmt: "date" },
          { header: "Rise %", width: 10, fmt: "pct" },
          { header: "Supplier", width: 26 },
          { header: "Services that use it (kept after materials at MSME rate: before -> now)", width: 64 },
        ],
        rows: d.priceChanges.map((p) => [
          p.name,
          Number(p.oldRate),
          p.oldDate,
          Number(p.newRate),
          p.newDate,
          p1(p.risePct),
          p.supplier,
          p.services.map((s) => `${s.name}: ${s.keptBeforePct?.toFixed(0) ?? "-"}% -> ${s.keptNowPct?.toFixed(0) ?? "-"}%`).join("; "),
        ]),
      };
    case "tied-up":
      return {
        title: "Money tied up in stock",
        columns: [
          { header: "Group", width: 16 },
          { header: "Name", width: 32 },
          { header: "Stock value (₹)", width: 14, fmt: "money" },
          { header: "Last used", width: 12, fmt: "date" },
        ],
        rows: [
          ...d.tiedUp.byCategory.map((c) => ["Category", c.name, rs(c.valuePaise), null]),
          ...d.tiedUp.byDepartment.map((c) => ["Department", c.name, rs(c.valuePaise), null]),
          ...d.tiedUp.slow.map((s) => [s.neverUsed ? "Never used" : "Slow-moving", s.name, rs(s.valuePaise), s.lastUsed]),
        ],
      };
    case "expiry":
      return {
        title: "Expiry losses",
        columns: [
          { header: "Item", width: 32 },
          { header: "Quantity written off", width: 14, fmt: "qty" },
          { header: "Unit", width: 8 },
          { header: "Value (₹)", width: 14, fmt: "money" },
        ],
        rows: d.expiry.items.map((i) => [i.name, Number(i.qty), i.unit, rs(i.valuePaise)]),
      };
    case "running-out":
      return {
        title: "Running out soon",
        columns: [
          { header: "Item", width: 32 },
          { header: "Code", width: 12 },
          { header: "Stock", width: 12, fmt: "qty" },
          { header: "Unit", width: 8 },
          { header: "Runs out in (days)", width: 12, fmt: "int" },
          { header: "Supplier lead time (days)", width: 12, fmt: "int" },
          { header: "Status", width: 34 },
        ],
        rows: d.runningOut.map((r) => [r.name, r.code, Number(r.qty), r.unit, r.runsOutDays == null ? null : Math.round(r.runsOutDays), r.leadTimeDays, VERDICT[r.verdict]]),
      };
  }
}

export const VERDICT = {
  out: "Out of stock",
  late: "Runs out before a delivery can arrive",
  order: "Order now",
  ok: "Enough for now",
} as const;
