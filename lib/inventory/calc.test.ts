import { describe, expect, it } from "vitest";
import { applyIn, applyOut, applyOutAtCost, averageDailyUse, pickBatches, runsOutInDays, shouldOrder, usableBatches, deliveryLate } from "./calc";
import { valuePaise } from "./numbers";

describe("weighted average cost", () => {
  it("receive 1,000 ml at ₹4.00 and 1,000 ml at ₹5.00 -> ₹4.50; use 500 ml -> ₹2,250, leaving 1,500 ml at ₹4.50", () => {
    let s = { qty: "0", avg: "0" };
    s = applyIn(s, "1000", "4");
    s = applyIn(s, "1000", "5");
    expect(s).toEqual({ qty: "2000.000", avg: "4.5000" });
    expect(valuePaise("500", s.avg)).toBe(2_250_00);
    s = applyOut(s, "500");
    expect(s).toEqual({ qty: "1500.000", avg: "4.5000" });
    expect(valuePaise(s.qty, s.avg)).toBe(6_750_00);
  });
  it("taking back a receipt returns stock and value to what they were", () => {
    const before = applyIn({ qty: "0", avg: "0" }, "1000", "4");
    const after = applyIn(before, "1000", "5");
    const back = applyOutAtCost(after, "1000", "5");
    expect(back).toEqual(before);
  });
  it("taking back the only receipt leaves 0 stock", () => {
    const s = applyOutAtCost(applyIn({ qty: "0", avg: "0" }, "300", "4.5"), "300", "4.5");
    expect(s.qty).toBe("0.000");
  });
});

describe("runs out in and reorder", () => {
  it("600 ml with 1,800 ml used in 90 days -> 20 ml a day -> 30 days: not on the list with 21 + 7 days; at 500 ml (25 days) it is", () => {
    const daily = averageDailyUse("1800", 90);
    expect(daily).toBe(20);
    expect(runsOutInDays("600", daily)).toBe(30);
    expect(shouldOrder({ qty: "600", reorderLevel: "300", runsOutDays: 30, leadTimeDays: 21, safetyDays: 7 })).toBe(false);
    expect(runsOutInDays("500", daily)).toBe(25);
    expect(shouldOrder({ qty: "500", reorderLevel: "300", runsOutDays: 25, leadTimeDays: 21, safetyDays: 7 })).toBe(true);
  });
  it("at or below the reorder level is always on the list; no recent use is not", () => {
    expect(shouldOrder({ qty: "300", reorderLevel: "300", runsOutDays: null, leadTimeDays: null, safetyDays: 7 })).toBe(true);
    expect(shouldOrder({ qty: "301", reorderLevel: "300", runsOutDays: null, leadTimeDays: 21, safetyDays: 7 })).toBe(false);
    expect(runsOutInDays("0", 5)).toBe(0);
    expect(runsOutInDays("100", 0)).toBeNull();
  });
});

describe("batches", () => {
  const today = "2026-11-20";
  const batches = [
    { id: "a", batchNo: "A", expiryDate: "2027-03-01", qty: "500" },
    { id: "b", batchNo: "B", expiryDate: "2026-12-10", qty: "200" },
    { id: "x", batchNo: "X", expiryDate: "2026-11-19", qty: "800" }, // expired yesterday
    { id: "n", batchNo: "N", expiryDate: null, qty: "100" },
    { id: "e", batchNo: "E", expiryDate: "2026-12-01", qty: "0" },
  ];
  it("uses the batch that expires first, never an expired one", () => {
    expect(usableBatches(batches, today).map((b) => b.batchNo)).toEqual(["B", "A", "N"]);
    expect(pickBatches(batches, "650", today)?.map((p) => `${p.batch.batchNo}:${p.qty}`)).toEqual(["B:200", "A:450"]);
    expect(pickBatches(batches, "801", today)).toBeNull(); // 800 usable (the expired 800 doesn't count)
  });
});

describe("deliveryLate", () => {
  it("is late only once the lead time has passed since the order", () => {
    expect(deliveryLate("2026-11-12", 7, "2026-11-19")).toBe(false); // due today
    expect(deliveryLate("2026-11-12", 7, "2026-11-20")).toBe(true);
    expect(deliveryLate("2026-11-12", 0, "2026-11-13")).toBe(true);
    expect(deliveryLate("2026-11-12", null, "2026-12-30")).toBe(false); // no lead time known
    expect(deliveryLate(null, 7, "2026-12-30")).toBe(false); // not ordered
  });
});
