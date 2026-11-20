import { describe, expect, it } from "vitest";
import { formatQty, formatRate, packRateToUnitRate, packsToUnits, packText, parseQty, parseRate, valuePaise } from "./numbers";
import { stockStatus } from "./stock";

describe("inventory numbers", () => {
  it("quantities: up to 3 decimals, commas allowed", () => {
    expect(parseQty("1,250.5")).toBe("1250.5");
    expect(parseQty("0.125")).toBe("0.125");
    expect(parseQty("1.2345")).toBeNull();
    expect(parseQty("-3")).toBeNull();
    expect(parseQty("abc")).toBeNull();
  });
  it("rates: up to 4 decimals, ₹ allowed", () => {
    expect(parseRate("₹4.5")).toBe("4.5");
    expect(parseRate("0.0525")).toBe("0.0525");
    expect(parseRate("0.05255")).toBeNull();
  });
  it("values are whole paise, rounded half up, with no floating-point drift", () => {
    expect(valuePaise("500", "4.5")).toBe(2_250_00);
    expect(valuePaise("0.1", "0.2")).toBe(2); // 0.02 rupees
    expect(valuePaise("3", "0.0525")).toBe(16); // 0.1575 -> 16 paise
    expect(valuePaise("1.005", "1")).toBe(101);
  });
  it("packs: 3 bottles of 1,000 ml at ₹4,500 per bottle = 3,000 ml at ₹4.50 per ml", () => {
    expect(packsToUnits("3", "1000")).toBe("3000");
    expect(packRateToUnitRate("4500", "1000")).toBe("4.5");
    expect(packText("3", "Bottle", "1000", "ml")).toBe("3 bottles of 1,000 ml = 3,000 ml");
    expect(packText("1", "Box", "100", "pcs")).toBe("1 box of 100 pcs = 100 pcs");
    expect(packText("2", "Box", "100", "pcs")).toBe("2 boxes of 100 pcs = 200 pcs");
  });
  it("formatting in Indian style", () => {
    expect(formatQty("145000", "ml")).toBe("1,45,000 ml");
    expect(formatQty("2.500")).toBe("2.5");
    expect(formatRate("4.5")).toBe("₹4.50");
    expect(formatRate("0.0525")).toBe("₹0.0525");
  });
  it("stock status: out at 0, low at or below the reorder level", () => {
    expect(stockStatus("0", "100")).toBe("out");
    expect(stockStatus("100", "100")).toBe("low");
    expect(stockStatus("100.001", "100")).toBe("in");
  });
});
