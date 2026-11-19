import { describe, expect, it } from "vitest";
import {
  amountInWords,
  billableQuantity,
  calculateTotals,
  customerRate,
  DEFAULT_PRICING_SETTINGS,
  financialYear,
  formatINR,
  formatQuoteNo,
  numberToIndianWords,
  priceTypeFor,
  quantityInWords,
  toPaise,
} from "./pricing";

const S = DEFAULT_PRICING_SETTINGS;
const SLA_IMPORTED = { rateMsme: "40.00", rateOem: "80.00" };
const FIVE_AXIS = { rateMsme: "1800.00", rateOem: "2000.00" };
const UTM = { rateMsme: "1800.00", rateOem: "2100.00" };
const XENON = { rateMsme: "80.00", rateOem: "120.00" };

describe("price type", () => {
  it("MSME non-member uses MSME rate with no discount", () => {
    const pt = priceTypeFor({ category: "MSME", isMcciaMember: false }, S);
    expect(pt).toMatchObject({ rateKind: "MSME", discountPct: 0, label: "MSME rate" });
  });
  it("MSME member gets 10% off the MSME rate", () => {
    const pt = priceTypeFor({ category: "MSME", isMcciaMember: true }, S);
    expect(pt.discountPct).toBe(10);
    expect(pt.label).toBe("MSME rate, less 10% MCCIA member discount");
    expect(pt.badge).toBe("MSME rate + 10% MCCIA member discount");
  });
  it.each(["OEM", "TIER1", "TIER2"] as const)("%s uses the OEM / Tier 1-2 rate", (category) => {
    expect(priceTypeFor({ category, isMcciaMember: false }, S).label).toBe("OEM / Tier 1-2 rate");
    expect(priceTypeFor({ category, isMcciaMember: true }, S).label).toBe(
      "OEM / Tier 1-2 rate, less 10% MCCIA member discount",
    );
  });
  it("non-MSME members get no discount when the setting is off", () => {
    const pt = priceTypeFor({ category: "OEM", isMcciaMember: true }, { ...S, applyDiscountToNonMsme: false });
    expect(pt.discountPct).toBe(0);
    // MSME members still get it
    expect(priceTypeFor({ category: "MSME", isMcciaMember: true }, { ...S, applyDiscountToNonMsme: false }).discountPct).toBe(10);
  });
  it("uses the discount % from settings", () => {
    expect(priceTypeFor({ category: "MSME", isMcciaMember: true }, { ...S, memberDiscountPct: 12.5 }).label).toBe(
      "MSME rate, less 12.5% MCCIA member discount",
    );
  });
});

describe("customer rate", () => {
  it("SLA imported resin for an MSME member is ₹36 per cc", () => {
    const r = customerRate(SLA_IMPORTED, priceTypeFor({ category: "MSME", isMcciaMember: true }, S));
    expect(r).toEqual({ listRatePaise: 4000, discountPct: 10, finalRatePaise: 3600 });
  });
  it("OEM rate is used for Tier 2", () => {
    const r = customerRate(SLA_IMPORTED, priceTypeFor({ category: "TIER2", isMcciaMember: false }, S));
    expect(r.finalRatePaise).toBe(8000);
  });
});

describe("billable quantity", () => {
  it("per cc = volume x parts", () => {
    expect(billableQuantity("PER_CC", { ccPerPart: 50, parts: 4 })).toBe(200);
    expect(billableQuantity("PER_CC", { ccPerPart: 12.5, parts: 3 })).toBe(37.5);
  });
  it("per hour = hours", () => expect(billableQuantity("PER_HOUR", { hours: 6 })).toBe(6));
  it("per sample = samples", () => expect(billableQuantity("PER_SAMPLE", { samples: 5 })).toBe(5));
  it("per hour (3 samples) = hours x runs", () => {
    expect(billableQuantity("PER_HOUR_3_SAMPLES", { hours: 8, samples: 5 })).toBe(16);
    expect(billableQuantity("PER_HOUR_3_SAMPLES", { hours: 8, samples: 3 })).toBe(8);
    expect(billableQuantity("PER_HOUR_3_SAMPLES", { hours: 8, samples: 7 })).toBe(24);
  });
  it("custom items use plain quantity", () => expect(billableQuantity(null, { quantity: 2 })).toBe(2));
  it("explains quantities in words", () => {
    expect(quantityInWords("PER_CC", { ccPerPart: 50, parts: 4 })).toBe("50 cc x 4 parts = 200 cc");
    expect(quantityInWords("PER_HOUR_3_SAMPLES", { hours: 8, samples: 5 })).toBe(
      "8 hours x 2 runs (5 samples) = 16 hours",
    );
  });
});

describe("done checklist (section 11)", () => {
  it("MSME member, Maharashtra: SLA imported 200 cc -> ₹8,496", () => {
    const pt = priceTypeFor({ category: "MSME", isMcciaMember: true }, S);
    const rate = customerRate(SLA_IMPORTED, pt);
    const t = calculateTotals(
      [{ billableQty: billableQuantity("PER_CC", { ccPerPart: 50, parts: 4 }), listRatePaise: rate.listRatePaise, discountPct: rate.discountPct }],
      { customerStateCode: "27" },
      S,
    );
    expect(t.subtotalPaise).toBe(toPaise(8000));
    expect(t.discountPaise).toBe(toPaise(800));
    expect(t.taxablePaise).toBe(toPaise(7200));
    expect(t.cgstPaise).toBe(toPaise(648));
    expect(t.sgstPaise).toBe(toPaise(648));
    expect(t.igstPaise).toBe(0);
    expect(t.grandTotalPaise).toBe(toPaise(8496));
    expect(t.amountInWords).toBe("Rupees Eight Thousand Four Hundred Ninety-Six Only");
  });

  it("OEM non-member, Karnataka: 5-axis 6 hours -> ₹14,160 with IGST", () => {
    const pt = priceTypeFor({ category: "OEM", isMcciaMember: false }, S);
    const rate = customerRate(FIVE_AXIS, pt);
    const t = calculateTotals([{ billableQty: 6, listRatePaise: rate.listRatePaise, discountPct: rate.discountPct }], { customerStateCode: "29" }, S);
    expect(t.subtotalPaise).toBe(toPaise(12000));
    expect(t.discountPaise).toBe(0);
    expect(t.intraState).toBe(false);
    expect(t.igstPaise).toBe(toPaise(2160));
    expect(t.cgstPaise + t.sgstPaise).toBe(0);
    expect(t.grandTotalPaise).toBe(toPaise(14160));
  });

  it("Tier 1 member, Maharashtra: UTM 5 samples -> ₹11,151", () => {
    const pt = priceTypeFor({ category: "TIER1", isMcciaMember: true }, S);
    const rate = customerRate(UTM, pt);
    const t = calculateTotals([{ billableQty: 5, listRatePaise: rate.listRatePaise, discountPct: rate.discountPct }], { customerStateCode: "27" }, S);
    expect(t.subtotalPaise).toBe(toPaise(10500));
    expect(t.discountPaise).toBe(toPaise(1050));
    expect(t.taxablePaise).toBe(toPaise(9450));
    expect(t.cgstPaise).toBe(toPaise("850.50"));
    expect(t.sgstPaise).toBe(toPaise("850.50"));
    expect(t.totalBeforeRoundPaise).toBe(toPaise(11151));
    expect(t.grandTotalPaise).toBe(toPaise(11151));
    expect(t.roundOffPaise).toBe(0);
  });

  it("MSME non-member, Maharashtra: Xenon 8 h, 5 samples -> ₹1,510.40 rounded to ₹1,510", () => {
    const pt = priceTypeFor({ category: "MSME", isMcciaMember: false }, S);
    const rate = customerRate(XENON, pt);
    const qty = billableQuantity("PER_HOUR_3_SAMPLES", { hours: 8, samples: 5 });
    expect(qty).toBe(16);
    const t = calculateTotals([{ billableQty: qty, listRatePaise: rate.listRatePaise, discountPct: rate.discountPct }], { customerStateCode: "27" }, S);
    expect(t.taxablePaise).toBe(toPaise(1280));
    expect(t.cgstPaise).toBe(toPaise("115.20"));
    expect(t.sgstPaise).toBe(toPaise("115.20"));
    expect(t.totalBeforeRoundPaise).toBe(toPaise("1510.40"));
    expect(t.roundOffPaise).toBe(-40);
    expect(t.grandTotalPaise).toBe(toPaise(1510));
  });

  it("custom-rate lines are not discounted again", () => {
    const t = calculateTotals(
      [
        { billableQty: 2, listRatePaise: toPaise(500), discountPct: 0 },
        { billableQty: 200, listRatePaise: toPaise(40), discountPct: 10 },
      ],
      { customerStateCode: "27" },
      S,
    );
    expect(t.subtotalPaise).toBe(toPaise(9000));
    expect(t.discountPaise).toBe(toPaise(800));
    expect(t.taxablePaise).toBe(toPaise(8200));
  });

  it("customer without a state code is treated as Maharashtra (intra-state)", () => {
    const t = calculateTotals([{ billableQty: 1, listRatePaise: toPaise(100), discountPct: 0 }], { customerStateCode: null }, S);
    expect(t.intraState).toBe(true);
  });
});

describe("formatting", () => {
  it("formats rupees the Indian way", () => {
    expect(formatINR(toPaise(125000))).toBe("₹1,25,000.00");
  });
  it("writes numbers in Indian words", () => {
    expect(numberToIndianWords(125000)).toBe("One Lakh Twenty-Five Thousand");
    expect(numberToIndianWords(23456789)).toBe("Two Crore Thirty-Four Lakh Fifty-Six Thousand Seven Hundred Eighty-Nine");
    expect(numberToIndianWords(100)).toBe("One Hundred");
    expect(amountInWords(toPaise("1510.40"))).toBe("Rupees One Thousand Five Hundred Ten and Forty Paise Only");
  });
  it("works out the financial year (April to March)", () => {
    expect(financialYear(new Date(2026, 3, 1))).toBe("2026-27");
    expect(financialYear(new Date(2027, 2, 31))).toBe("2026-27");
    expect(financialYear(new Date(2026, 2, 31))).toBe("2025-26");
    expect(financialYear(new Date(2099, 5, 1))).toBe("2099-00");
  });
  it("formats quotation numbers", () => {
    expect(formatQuoteNo("ACDRI/QT", "2026-27", 1)).toBe("ACDRI/QT/2026-27/0001");
  });
});
