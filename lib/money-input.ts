import { toPaise } from "./pricing";

/** Parses what staff type into an amount box ("1,25,000.50", "₹ 8496") into paise; null when it isn't a valid amount. */
export function parseRupees(text: string): number | null {
  const s = text.replace(/[,₹\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return toPaise(s);
}
