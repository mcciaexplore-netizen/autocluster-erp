import { describe, expect, it } from "vitest";
import { istAt, patternFromSettings } from "./hours";
import { machineUse, mergeSpans, weekStart } from "./use";

const P = patternFromSettings({ workingDays: [1, 2, 3, 4, 5, 6], shiftStart: "09:00", shiftEnd: "18:00", breakStart: "13:00", breakEnd: "13:30" }, []);
const at = (date: string, time: string) => istAt(date, Number(time.slice(0, 2)) * 60 + Number(time.slice(3)));
const week = { start: at("2026-11-30", "00:00"), end: at("2026-12-07", "00:00") }; // Mon 30 Nov to Mon 7 Dec

describe("machine use %", () => {
  it("shift machine: working hours minus blocked time; a booking counts only its working hours", () => {
    const r = machineUse({
      window: week,
      pattern: P,
      nonstop: false,
      parallelJobs: 1,
      // Monday maintenance all day (8.5 h), plus an overlapping block that must not count twice
      blocks: [
        { start: at("2026-11-30", "09:00"), end: at("2026-11-30", "18:00") },
        { start: at("2026-11-30", "15:00"), end: at("2026-11-30", "17:00") },
      ],
      // Tue 15:00 to Wed 12:00 = 3 h + 3 h of working time (the night doesn't count)
      bookings: [{ start: at("2026-12-01", "15:00"), end: at("2026-12-02", "12:00") }],
      running: [{ start: at("2026-12-01", "15:00"), end: at("2026-12-01", "17:30") }],
    });
    expect(r.blockedHours).toBe(8.5);
    expect(r.availableHours).toBe(5 * 8.5);
    expect(r.bookedHours).toBe(6);
    expect(r.bookedPct).toBeCloseTo((6 / 42.5) * 100, 6);
    expect(r.actualHours).toBe(2.5);
  });

  it("day-and-night chamber: 24 h a day minus blocked time; 2 jobs at the same time doubles what's available", () => {
    const r = machineUse({
      window: week,
      pattern: P,
      nonstop: true,
      parallelJobs: 2,
      blocks: [{ start: at("2026-12-06", "00:00"), end: at("2026-12-07", "00:00") }], // Sunday calibration
      bookings: [
        { start: at("2026-11-30", "10:00"), end: at("2026-12-04", "10:00") }, // 96 h
        { start: at("2026-11-28", "00:00"), end: at("2026-12-01", "00:00") }, // only 24 h inside the week
      ],
    });
    expect(r.availableHours).toBe(6 * 24 * 2);
    expect(r.bookedHours).toBe(120);
    expect(r.bookedPct).toBeCloseTo((120 / 288) * 100, 6);
  });

  it("blocked all week: nothing available, so no % (not a division by zero)", () => {
    const r = machineUse({ window: week, pattern: P, nonstop: false, parallelJobs: 1, blocks: [week], bookings: [] });
    expect(r).toMatchObject({ availableHours: 0, bookedPct: null });
  });

  it("helpers: merging spans and the Monday of a week", () => {
    expect(mergeSpans([{ start: at("2026-11-30", "09:00"), end: at("2026-11-30", "11:00") }, { start: at("2026-11-30", "10:00"), end: at("2026-11-30", "12:00") }])).toHaveLength(1);
    expect(weekStart("2026-12-03")).toBe("2026-11-30");
    expect(weekStart("2026-11-30")).toBe("2026-11-30");
    expect(weekStart("2026-12-06")).toBe("2026-11-30"); // Sunday belongs to the week that started Monday
  });
});
