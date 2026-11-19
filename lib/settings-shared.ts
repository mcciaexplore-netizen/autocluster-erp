import type { PricingSettings } from "./pricing";

export const DEFAULT_TERMS = [
  "Rates are standard charges for a standard test or job. Any extra operation will be charged separately.",
  "Rates are as per the AutoCluster rate card effective 1 November 2025 and are confirmed in this quotation.",
  "GST will be charged as applicable.",
  "This quotation is valid for 30 days from the date of issue.",
  "Payment terms: [to be confirmed].",
]
  .map((t, i) => `${i + 1}. ${t}`)
  .join("\n");

type SettingsLike = {
  memberDiscountPct: string | number;
  applyDiscountToNonMsme: boolean;
  gstPct: string | number;
  homeStateCode: string;
};

export function toPricingSettings(s: SettingsLike): PricingSettings {
  return {
    memberDiscountPct: Number(s.memberDiscountPct),
    applyDiscountToNonMsme: s.applyDiscountToNonMsme,
    gstPct: Number(s.gstPct),
    homeStateCode: s.homeStateCode,
  };
}
