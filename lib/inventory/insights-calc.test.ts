import { describe, expect, it } from "vitest";
import { todayInIndia } from "@/lib/tickets";
import { isSlowMoving, priceRise } from "./insights-calc";

describe("price change", () => {
  const rs = [
    { date: "2026-05-24", rate: "13.5" },
    { date: "2026-08-06", rate: "14.2" },
    { date: "2026-10-31", rate: "15.93" },
  ];
  it("compares the latest delivery with the first one in the period: SLA resin up 18% since May", () => {
    const r = priceRise(rs, "2026-04-01", "2026-11-20", 10)!;
    expect(r.old).toEqual({ date: "2026-05-24", rate: "13.5" });
    expect(r.latest.rate).toBe("15.93");
    expect(r.risePct).toBeCloseTo(18, 5);
  });
  it("uses the last delivery before the period when there is one", () => {
    expect(priceRise(rs, "2026-08-01", "2026-11-20", 10)!.old.rate).toBe("13.5");
    expect(priceRise(rs, "2026-09-01", "2026-11-20", 10)!.risePct).toBeCloseTo(12.18, 1);
  });
  it("nothing when the rise is not above the alert %, or there is no delivery in the period", () => {
    expect(priceRise(rs, "2026-04-01", "2026-11-20", 18)).toBeNull();
    expect(priceRise(rs, "2026-11-01", "2026-11-20", 10)).toBeNull();
    expect(priceRise(rs.slice(0, 1), "2026-04-01", "2026-11-20", 10)).toBeNull();
  });
});

describe("slow-moving", () => {
  it("in stock and not used in the last 90 days (India date)", () => {
    // 1:30 am on 20 Nov in India is still 19 Nov in UTC: the India date is what counts.
    const today = todayInIndia(new Date("2026-11-19T20:00:00Z"));
    expect(today).toBe("2026-11-20");
    expect(isSlowMoving({ qty: "5.4", lastUsed: "2026-08-22" }, today, 90)).toBe(true); // exactly 90 days
    expect(isSlowMoving({ qty: "5.4", lastUsed: "2026-08-23" }, today, 90)).toBe(false);
    expect(isSlowMoving({ qty: "10", lastUsed: null }, today, 90)).toBe(true); // never used
    expect(isSlowMoving({ qty: "0", lastUsed: null }, today, 90)).toBe(false); // nothing in stock
  });
});
