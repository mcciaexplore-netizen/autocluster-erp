import { describe, expect, it } from "vitest";
import { billingUnitName, keptAfterMaterials, stockHint, suggestMaterials } from "./materials";
import { valuePaise } from "./numbers";

const resin = { itemId: "r", name: "SLA resin", unit: "ml", qtyPerUnit: "1.15", inStock: "1450" };
const ipa = { itemId: "i", name: "IPA for cleaning", unit: "ml", qtyPerUnit: "0.05", inStock: "5" };

describe("materials for a job", () => {
  it("a 200 cc SLA ticket with 1.15 ml per cc suggests 230 ml; at ₹4.50 per ml that's ₹1,035, and ₹7,200 keeps ₹6,165 (85.6%)", () => {
    const [s] = suggestMaterials("200", "per cc", [resin]);
    expect(s.qty).toBe("230");
    expect(s.explain).toBe("200 cc × 1.15 ml per cc = 230 ml");
    const cost = valuePaise(s.qty, "4.5");
    expect(cost).toBe(1_035_00);
    expect(keptAfterMaterials(7_200_00, cost)).toEqual({ keptPaise: 6_165_00, pct: 85.6 });
  });
  it("billing unit names", () => {
    expect(billingUnitName("per hour (up to 3 samples)")).toBe("hour");
    expect(billingUnitName("per sample")).toBe("sample");
  });
  it("stock hints: enough, or which items are short", () => {
    expect(stockHint(suggestMaterials("200", "per cc", [resin]))).toEqual({ ok: true, text: "Enough stock" });
    expect(stockHint(suggestMaterials("200", "per cc", [{ ...resin, inStock: "150" }, ipa]))).toEqual({
      ok: false,
      text: "Low stock: SLA resin (needs ~230 ml, 150 ml in stock); IPA for cleaning (needs ~10 ml, 5 ml in stock)",
    });
    expect(stockHint([])).toBeNull();
  });
  it("kept after materials when there is no value", () => {
    expect(keptAfterMaterials(0, 0)).toEqual({ keptPaise: 0, pct: null });
  });
});
