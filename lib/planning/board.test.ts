import { describe, expect, it } from "vitest";
import { bookedHoursByDay, boardSummary, daySegments, hourLabels, nonWorking, visibleRange, workingParts } from "./board";
import { istAt, patternFromSettings } from "./hours";

// Week of Monday 23 Nov 2026 (India time).
const WEEK = "2026-11-23";
const at = (date: string, hh: number, mm = 0) => istAt(date, hh * 60 + mm);
const pattern = patternFromSettings({ workingDays: [1, 2, 3, 4, 5, 6], shiftStart: "09:00", shiftEnd: "18:00", breakStart: "13:00", breakEnd: "13:30" }, ["2026-11-27"]);

describe("Department board drawing rules", () => {
  it("a Tue 10:00-13:00 booking draws exactly in Tuesday's 10-13 rows", () => {
    expect(daySegments(at("2026-11-24", 10), at("2026-11-24", 13), WEEK)).toEqual([{ day: 1, startMin: 600, endMin: 780 }]);
  });

  it("a booking from Wed 22:00 to Thu 04:00 continues in Thursday's column", () => {
    expect(daySegments(at("2026-11-25", 22), at("2026-11-26", 4), WEEK)).toEqual([
      { day: 2, startMin: 1320, endMin: 1440 },
      { day: 3, startMin: 0, endMin: 240 },
    ]);
  });

  it("long runs fill whole days; parts outside the week are left out", () => {
    const g = daySegments(at("2026-11-21", 12), at("2026-11-25", 6), WEEK); // Sat before -> Wed
    expect(g).toEqual([
      { day: 0, startMin: 0, endMin: 1440 },
      { day: 1, startMin: 0, endMin: 1440 },
      { day: 2, startMin: 0, endMin: 360 },
    ]);
    expect(daySegments(at("2026-12-01", 9), at("2026-12-01", 10), WEEK)).toEqual([]);
  });

  it("visible hours: working hours plus 1 hour either side; 24 hours for day-and-night machines or the switch", () => {
    expect(visibleRange({ runsNonstop: false }, pattern, false)).toEqual({ from: 480, to: 1140 }); // 08:00-19:00
    expect(visibleRange({ runsNonstop: true }, pattern, false)).toEqual({ from: 0, to: 1440 });
    expect(visibleRange({ runsNonstop: false }, pattern, true)).toEqual({ from: 0, to: 1440 });
    // A booking stored across several days on an operator machine counts only working time: Tue 08:00 to Wed 12:00
    // = Tue 09:00-13:00 and 13:30-18:00 (8.5 h) + Wed 09:00-12:00 (3 h).
    const segs = daySegments(at("2026-11-24", 8), at("2026-11-25", 12), WEEK);
    expect(bookedHoursByDay(workingParts(segs, WEEK, pattern, false))).toEqual([0, 8.5, 3, 0, 0, 0, 0]);
    expect(bookedHoursByDay(workingParts(segs, WEEK, pattern, true))).toEqual([0, 16, 12, 0, 0, 0, 0]);
    expect(hourLabels({ from: 480, to: 1140 })).toEqual([480, 600, 720, 840, 960, 1080]);
  });

  it("holidays and non-working days are shaded all day; working days outside the shift and the break", () => {
    expect(nonWorking("2026-11-27", pattern, false)).toEqual([{ startMin: 0, endMin: 1440 }]); // holiday (Friday)
    expect(nonWorking("2026-11-29", pattern, false)).toEqual([{ startMin: 0, endMin: 1440 }]); // Sunday
    expect(nonWorking("2026-11-24", pattern, false)).toEqual([
      { startMin: 0, endMin: 540 },
      { startMin: 1080, endMin: 1440 },
      { startMin: 780, endMin: 810 },
    ]);
    expect(nonWorking("2026-11-27", pattern, true)).toEqual([]); // day-and-night machines run every day
  });

  it("blocked time splits across days like bookings", () => {
    expect(daySegments(at("2026-11-26", 17), at("2026-11-27", 11), WEEK)).toEqual([
      { day: 3, startMin: 1020, endMin: 1440 },
      { day: 4, startMin: 0, endMin: 660 },
    ]);
  });

  it("hours booked per day: overlapping (parallel) bookings count once", () => {
    const segs = [
      { day: 1, startMin: 600, endMin: 780 },
      { day: 1, startMin: 720, endMin: 840 }, // overlaps 12:00-13:00
      { day: 3, startMin: 0, endMin: 240 },
    ];
    expect(bookedHoursByDay(segs)).toEqual([0, 4, 0, 4, 0, 0, 0]);
    expect(boardSummary(2, 4, 61.6)).toBe("Running now: 2 · Free now: 4 · This week: 62% booked");
  });
});
