import { describe, expect, it } from "vitest";
import { istAt } from "./hours";
import { actualHours, isOverrun, quotedVsActual, sinceText } from "./work";

const at = (time: string) => istAt("2026-11-30", Number(time.slice(0, 2)) * 60 + Number(time.slice(3)));

describe("work on a job", () => {
  it("actual hours: start 10:00, pause 12:00, resume 14:00, done 15:30 -> 3.5 h", () => {
    expect(
      actualHours([
        { startedAt: at("10:00"), endedAt: at("12:00") },
        { startedAt: at("14:00"), endedAt: at("15:30") },
      ]),
    ).toBe(3.5);
    // still running: counts to now
    expect(actualHours([{ startedAt: at("10:00"), endedAt: null }], at("11:15"))).toBe(1.25);
  });

  it("actual vs quoted: quoted 6 h, took 7 h -> +16.7%, flagged above the 10% alert", () => {
    expect(quotedVsActual(6, 7, 10)).toEqual({ pct: 16.7, flagged: true });
    expect(quotedVsActual(6, 6.5, 10)).toEqual({ pct: 8.3, flagged: false });
    expect(quotedVsActual(null, 7, 10)).toEqual({ pct: null, flagged: false });
  });

  it("still running? only past the booked end by more than the warning % of the booked time", () => {
    const booked = { start: at("09:00"), end: at("17:00") }; // 8 h -> 50% = 4 h
    expect(isOverrun(booked, at("20:59"), 50)).toBe(false);
    expect(isOverrun(booked, at("21:01"), 50)).toBe(true);
    expect(sinceText(at("09:00"), at("23:00"))).toBe("14 h");
  });
});
