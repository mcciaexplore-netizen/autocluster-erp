import { describe, expect, it } from "vitest";
import { istAt, patternFromSettings } from "./hours";
import { aboutPaise, daysBetween, deptDayCapacity, earningsByMachine, extraValuePaise, hoursPerDay, monthWindowIn, monthsBetween, onTimeTable, workingDays, workingHoursIn } from "./insights-calc";

const pattern = patternFromSettings(
  {
    workingDays: [1, 2, 3, 4, 5, 6],
    shiftStart: "09:00",
    shiftEnd: "18:00",
    breakStart: "13:00",
    breakEnd: "13:30",
  },
  [],
);

describe("planning insights maths", () => {
  it("lists months and clips a month to the range", () => {
    expect(monthsBetween("2026-10-15", "2027-01-02")).toEqual(["2026-10", "2026-11", "2026-12", "2027-01"]);
    const range = {
      start: istAt("2026-11-10", 0),
      end: istAt("2026-12-05", 0),
    };
    expect(monthWindowIn("2026-11", range)).toEqual({
      start: istAt("2026-11-10", 0),
      end: istAt("2026-12-01", 0),
    });
    expect(monthWindowIn("2026-12", range)).toEqual({
      start: istAt("2026-12-01", 0),
      end: istAt("2026-12-05", 0),
    });
    expect(monthWindowIn("2027-01", range)).toBeNull();
  });

  it("counts working hours inside a window", () => {
    // Mon 23 Nov 2026 whole day blocked: 8.5 working hours, 24 for a day-and-night machine.
    const s = { start: istAt("2026-11-23", 0), end: istAt("2026-11-24", 0) };
    const w = { start: istAt("2026-11-01", 0), end: istAt("2026-12-01", 0) };
    expect(workingHoursIn(s, w, pattern, false)).toBe(8.5);
    expect(workingHoursIn(s, w, pattern, true)).toBe(24);
    expect(workingHoursIn(s, { start: istAt("2026-11-23", 14 * 60), end: istAt("2026-12-01", 0) }, pattern, false)).toBe(4);
  });

  it("works out days of work from department capacity", () => {
    expect(hoursPerDay(pattern)).toBe(8.5);
    const cap = deptDayCapacity(
      [
        { runsNonstop: false, parallelJobs: 1 },
        { runsNonstop: true, parallelJobs: 2 },
      ],
      8.5,
    );
    expect(cap).toBe(56.5);
    expect(workingDays(113, cap)).toBe(2);
    expect(workingDays(17, 8.5)).toBe(2);
    expect(workingDays(1000, 8.5)).toBe(118);
    expect(workingDays(5, 0)).toBeNull();
  });

  it("values extra hours and rounds money for a sentence", () => {
    expect(extraValuePaise(6, 7.5, 1800_00)).toBe(2700_00);
    expect(extraValuePaise(6, 5, 1800_00)).toBe(0);
    expect(aboutPaise(41_234_56)).toBe(41_000_00);
    expect(aboutPaise(4_567_00)).toBe(4_600_00);
  });

  it("works out on-time % by department and month", () => {
    const t = onTimeTable(
      [
        { dept: "RPT", promised: "2026-10-10", done: "2026-10-09" },
        { dept: "RPT", promised: "2026-10-10", done: "2026-10-12" },
        { dept: "ENV", promised: "2026-11-05", done: "2026-11-05" },
        { dept: "ENV", promised: "2026-09-01", done: "2026-09-02" },
      ],
      ["2026-10", "2026-11"],
    );
    expect(t.overall).toEqual({ done: 3, onTime: 2, pct: (2 / 3) * 100 });
    expect(t.months.map((m) => m.pct)).toEqual([50, 100]);
    expect(t.depts.find((d) => d.dept === "RPT")!.overall.pct).toBe(50);
    expect(t.depts.find((d) => d.dept === "ENV")!.cells[0].pct).toBeNull();
    expect(daysBetween("2026-10-10", "2026-10-12")).toBe(2);
  });

  it("splits a job's value over machines by hours run", () => {
    const e = earningsByMachine([
      {
        valuePaise: 9000_00,
        hours: new Map([
          ["a", 2],
          ["b", 1],
        ]),
      },
      { valuePaise: 3000_00, hours: new Map([["a", 1]]) },
      { valuePaise: 5000_00, hours: new Map() },
    ]);
    expect(e.get("a")).toEqual({ jobs: 2, hours: 3, valuePaise: 9000_00 });
    expect(e.get("b")).toEqual({ jobs: 1, hours: 1, valuePaise: 3000_00 });
  });
});
