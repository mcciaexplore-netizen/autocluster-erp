import { describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/auth/guard", () => ({ need: async () => ({ grants: {} }), moneyView: () => ({ sale: true, stock: true }) }));

describe("insights helpers", async () => {
  const { monthsBetween, insightFiltersFromParams } = await import("@/lib/inventory-insights");
  it("lists every month in the range, across the year end", () => {
    expect(monthsBetween("2026-11-15", "2027-02-01")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
    expect(monthsBetween("2026-04-01", "2026-04-30")).toEqual(["2026-04"]);
  });
  it("reads the filters, swapping dates given the wrong way round and ignoring bad values", async () => {
    expect(await insightFiltersFromParams({ from: "2026-09-30", to: "2026-04-01", dept: "RPT" })).toEqual({ from: "2026-04-01", to: "2026-09-30", dept: "RPT" });
    expect((await insightFiltersFromParams({ from: "x", dept: "rpt; drop" })).dept).toBeNull();
  });
});
