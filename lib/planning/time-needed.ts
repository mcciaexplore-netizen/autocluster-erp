/** "Time needed" suggestions for a job (brief section 5.2 / 5.4). Pure and unit-tested. */

export type UnitTypeName = "PER_CC" | "PER_HOUR" | "PER_SAMPLE" | "PER_HOUR_3_SAMPLES";

/** Per-hour services take the ticket's billable hours; they don't need time settings. */
export const isPerHour = (u: UnitTypeName | null | undefined) => u === "PER_HOUR" || u === "PER_HOUR_3_SAMPLES";

/** True when a service needs time settings but has none (the amber "No time set" chip). */
export const noTimeSet = (s: { unitType: UnitTypeName; setupMinutes: number | null; minutesPerUnit: string | number | null }) =>
  !isPerHour(s.unitType) && s.setupMinutes == null && s.minutesPerUnit == null;

/**
 * Suggested hours for a job: per-hour services use the billable hours; others use
 * setup minutes + minutes per unit x billable quantity. null when there's nothing to go on.
 * Rounded up to the next half hour, as bookings are in half hours.
 */
export function suggestHours(p: { unitType: UnitTypeName | null; billableQty: number; setupMinutes: number | null; minutesPerUnit: string | number | null }): number | null {
  if (isPerHour(p.unitType)) return p.billableQty > 0 ? p.billableQty : null;
  if (p.setupMinutes == null && p.minutesPerUnit == null) return null;
  const minutes = (p.setupMinutes ?? 0) + Number(p.minutesPerUnit ?? 0) * p.billableQty;
  if (!(minutes > 0)) return null;
  return Math.ceil(minutes / 30) / 2;
}

/** "30 min setup + 15 min per sample". */
export function timeSettingText(s: { setupMinutes: number | null; minutesPerUnit: string | number | null; unitLabel: string }): string {
  const parts: string[] = [];
  if (s.setupMinutes) parts.push(`${s.setupMinutes} min setup`);
  if (s.minutesPerUnit != null && Number(s.minutesPerUnit) > 0) parts.push(`${Number(s.minutesPerUnit)} min ${s.unitLabel}`);
  return parts.join(" + ") || "No time";
}
