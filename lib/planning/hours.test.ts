import { describe, expect, it } from "vitest";
import { addWorkingHours, formatWhen, istAt, maxAtOnce, nextWorkingMoment, patternFromSettings, segmentsOn, snapTo30, workingMinutesBetween } from "./hours";

// Shift 09:00-18:00, break 13:00-13:30, Mon-Sat, holiday on Fri 25 Dec 2026 (brief section 15).
const P = patternFromSettings({ workingDays: [1, 2, 3, 4, 5, 6], shiftStart: "09:00", shiftEnd: "18:00", breakStart: "13:00", breakEnd: "13:30" }, ["2026-12-25"]);
const at = (date: string, time: string) => istAt(date, Number(time.slice(0, 2)) * 60 + Number(time.slice(3)));

describe("working hours", () => {
  it("a working day has 8.5 working hours, split by the break; Sundays and holidays have none", () => {
    expect(segmentsOn("2026-11-27", P)).toEqual([
      [540, 780],
      [810, 1080],
    ]);
    expect(segmentsOn("2026-11-29", P)).toEqual([]); // Sunday
    expect(segmentsOn("2026-12-25", P)).toEqual([]); // holiday
  });

  it("shift machine, 6 h from Fri 27 Nov 15:00: 3 h Friday + 3 h Saturday -> Sat 28 Nov 12:00", () => {
    const end = addWorkingHours(at("2026-11-27", "15:00"), 6, P, false);
    expect(end).toEqual(at("2026-11-28", "12:00"));
    expect(formatWhen(end)).toBe("Sat 28 Nov, 12:00");
  });

  it("shift machine, 6 h from Sat 28 Nov 16:00: 2 h Saturday, Sunday skipped, 4 h Monday -> Mon 30 Nov 13:00", () => {
    expect(addWorkingHours(at("2026-11-28", "16:00"), 6, P, false)).toEqual(at("2026-11-30", "13:00"));
  });

  it("shift machine, 4 h from Thu 24 Dec 16:00: 2 h Thursday, holiday skipped -> Sat 26 Dec 11:00", () => {
    expect(addWorkingHours(at("2026-12-24", "16:00"), 4, P, false)).toEqual(at("2026-12-26", "11:00"));
  });

  it("day-and-night chamber, 96 h from Mon 30 Nov 10:00 -> Fri 4 Dec 10:00", () => {
    expect(addWorkingHours(at("2026-11-30", "10:00"), 96, P, true)).toEqual(at("2026-12-04", "10:00"));
  });

  it("the break is skipped; a start outside working time begins at the next working moment", () => {
    expect(addWorkingHours(at("2026-11-30", "12:00"), 2, P, false)).toEqual(at("2026-11-30", "14:30"));
    expect(addWorkingHours(at("2026-11-30", "19:00"), 1, P, false)).toEqual(at("2026-12-01", "10:00"));
    expect(nextWorkingMoment(at("2026-11-28", "18:00"), P, false)).toEqual(at("2026-11-30", "09:00"));
    expect(nextWorkingMoment(at("2026-11-30", "13:10"), P, false)).toEqual(at("2026-11-30", "13:30"));
  });

  it("working minutes between two moments (used for machine use %)", () => {
    expect(workingMinutesBetween(at("2026-11-30", "00:00"), at("2026-12-07", "00:00"), P, false)).toBe(6 * 510);
    expect(workingMinutesBetween(at("2026-11-30", "00:00"), at("2026-12-07", "00:00"), P, true)).toBe(7 * 24 * 60);
    expect(workingMinutesBetween(at("2026-12-21", "00:00"), at("2026-12-28", "00:00"), P, false)).toBe(5 * 510); // holiday week
  });

  it("snaps to the nearest half hour", () => {
    expect(snapTo30(at("2026-11-30", "10:14"))).toEqual(at("2026-11-30", "10:00"));
    expect(snapTo30(at("2026-11-30", "10:16"))).toEqual(at("2026-11-30", "10:30"));
  });

  it("jobs at the same time: the most bookings running at once; back-to-back doesn't overlap", () => {
    const b = (a: string, z: string) => ({ start: at("2026-11-30", a), end: at("2026-11-30", z) });
    const win = b("10:00", "14:00");
    expect(maxAtOnce([b("09:00", "11:00"), b("12:00", "15:00")], win)).toBe(1);
    expect(maxAtOnce([b("09:00", "12:30"), b("12:00", "15:00")], win)).toBe(2);
    expect(maxAtOnce([b("08:00", "10:00"), b("14:00", "16:00")], win)).toBe(0);
  });
});
