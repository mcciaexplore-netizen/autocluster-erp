/**
 * Up to two initials for the organisation's placeholder logo (PDFs, Settings), from its name:
 * "Demo Manufacturing Co., Pune" -> "DM"; "Auto Cluster Development and Research Institute (ACDRI)" -> "AC".
 * Words in brackets, small words and company endings are skipped.
 */
const SKIP = new Set(["and", "of", "the", "&", "co", "co.", "pvt", "pvt.", "ltd", "ltd.", "limited", "private", "llp", "inc", "inc."]);

export function orgInitials(name: string): string {
  const words = name
    .replace(/\([^)]*\)/g, " ")
    .split(/[\s,]+/)
    .filter((w) => w && !SKIP.has(w.toLowerCase()) && /^[A-Za-z]/.test(w));
  return words.slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "•";
}
