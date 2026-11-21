import { describe, expect, it } from "vitest";
import { noTimeSet, suggestHours, timeSettingText } from "./time-needed";

describe("time needed", () => {
  it("per-hour services use the billable hours (incl. hours per run of 3 samples)", () => {
    expect(suggestHours({ unitType: "PER_HOUR", billableQty: 6, setupMinutes: null, minutesPerUnit: null })).toBe(6);
    expect(suggestHours({ unitType: "PER_HOUR_3_SAMPLES", billableQty: 16, setupMinutes: 30, minutesPerUnit: null })).toBe(16);
  });
  it("other services: setup + minutes per unit x quantity, rounded up to a half hour", () => {
    // FTIR: 15 min per sample, 10 min setup, 8 samples = 130 min -> 2.5 h
    expect(suggestHours({ unitType: "PER_SAMPLE", billableQty: 8, setupMinutes: 10, minutesPerUnit: "15" })).toBe(2.5);
    // SLA: 1.2 min per cc, 60 min setup, 200 cc = 300 min -> 5 h
    expect(suggestHours({ unitType: "PER_CC", billableQty: 200, setupMinutes: 60, minutesPerUnit: 1.2 })).toBe(5);
    expect(suggestHours({ unitType: "PER_SAMPLE", billableQty: 5, setupMinutes: null, minutesPerUnit: null })).toBeNull();
    expect(suggestHours({ unitType: null, billableQty: 1, setupMinutes: null, minutesPerUnit: null })).toBeNull(); // custom item
  });
  it("the No time set chip and the summary text", () => {
    expect(noTimeSet({ unitType: "PER_SAMPLE", setupMinutes: null, minutesPerUnit: null })).toBe(true);
    expect(noTimeSet({ unitType: "PER_HOUR", setupMinutes: null, minutesPerUnit: null })).toBe(false);
    expect(noTimeSet({ unitType: "PER_CC", setupMinutes: 0, minutesPerUnit: null })).toBe(false);
    expect(timeSettingText({ setupMinutes: 10, minutesPerUnit: "15.00", unitLabel: "per sample" })).toBe("10 min setup + 15 min per sample");
  });
});
