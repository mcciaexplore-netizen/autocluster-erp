import { formatINR, toPaise } from "./pricing";

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

/** "2026-11-18" -> "18 Nov 2026" */
export function formatDate(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  const d = typeof iso === "string" ? new Date(`${iso.slice(0, 10)}T00:00:00`) : iso;
  return dateFmt.format(d);
}

/** Today's date as YYYY-MM-DD in local time. */
export function todayIso(): string {
  return toIso(new Date());
}

export function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toIso(d);
}

/** Formats a money value stored as a numeric string in the database. */
export function money(rupees: string | number): string {
  return formatINR(toPaise(rupees));
}
