/**
 * A machine's live status, worked out from right now (one chip everywhere a machine's status shows):
 * - Running (green): a job is running on it ("Running: 0275 (Rohan)").
 * - Booked, not started (amber): a booking covers now but nobody pressed Start ("Booked now: 0273, not started").
 * - Free (grey): no booking now and the machine is in service.
 * - Under maintenance / Calibration / Breakdown / other blocked time (red), "back at 17:00" when known.
 * - Inactive (grey, faded).
 * The machine form's setting (In service, Under maintenance, Breakdown, Inactive) is its condition; this is what
 * it's doing now. Pure: the loaders, the pages and the tests use the same rules.
 */
import { istDate } from "./hours";

export type LiveKind = "running" | "booked" | "free" | "maintenance" | "calibration" | "breakdown" | "blocked" | "inactive";

export interface LiveStatus {
  kind: LiveKind;
  label: string;
}

export interface LiveInput {
  machine: { status: "AVAILABLE" | "MAINTENANCE" | "BREAKDOWN" | "INACTIVE"; isActive: boolean };
  now: Date;
  /** An open time log on this machine. */
  running?: { ticketNo: string; operator: string | null } | null;
  /** A booking that covers now (of a job not finished). */
  bookingNow?: { ticketNo: string } | null;
  /** Blocked time that covers now. */
  blockNow?: { type: string; end: Date } | null;
}

const short = (ticketNo: string) => ticketNo.split("/").pop() ?? ticketNo;
const first = (name: string | null) => (name ? ` (${name.split(" ")[0]})` : "");
const BLOCK: Record<string, { kind: LiveKind; label: string }> = {
  MAINTENANCE: { kind: "maintenance", label: "Under maintenance" },
  CALIBRATION: { kind: "calibration", label: "Calibration" },
  BREAKDOWN: { kind: "breakdown", label: "Breakdown" },
  INTERNAL: { kind: "blocked", label: "Internal use" },
  OTHER: { kind: "blocked", label: "Not available" },
};

/** "back at 17:00" today, "back Fri 17:00" on another day (India time). */
export function backAt(end: Date, now: Date): string {
  const t = new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }).format(end);
  if (istDate(end) === istDate(now)) return `back at ${t}`;
  const day = new Intl.DateTimeFormat("en-IN", { weekday: "short", timeZone: "Asia/Kolkata" }).format(end);
  return `back ${day} ${t}`;
}

export function liveStatus(i: LiveInput): LiveStatus {
  if (!i.machine.isActive || i.machine.status === "INACTIVE") return { kind: "inactive", label: "Inactive" };
  if (i.running) return { kind: "running", label: `Running: ${short(i.running.ticketNo)}${first(i.running.operator)}` };
  if (i.blockNow) {
    const b = BLOCK[i.blockNow.type] ?? BLOCK.OTHER;
    return { kind: b.kind, label: `${b.label} · ${backAt(i.blockNow.end, i.now)}` };
  }
  if (i.machine.status === "BREAKDOWN") return { kind: "breakdown", label: "Breakdown" };
  if (i.machine.status === "MAINTENANCE") return { kind: "maintenance", label: "Under maintenance" };
  if (i.bookingNow) return { kind: "booked", label: `Booked now: ${short(i.bookingNow.ticketNo)}, not started` };
  return { kind: "free", label: "Free" };
}

/** Out of use right now (the Home "Machines not available" count): maintenance, calibration, breakdown and inactive. */
export const isOutOfUse = (k: LiveKind) => k === "maintenance" || k === "calibration" || k === "breakdown" || k === "inactive";

export const LIVE_CHIP: Record<LiveKind, string> = {
  running: "border-emerald-300 bg-emerald-50 text-emerald-800",
  booked: "border-amber-300 bg-amber-50 text-amber-900",
  free: "border-slate-200 bg-slate-100 text-slate-700",
  maintenance: "border-red-200 bg-red-50 text-red-800",
  calibration: "border-red-200 bg-red-50 text-red-800",
  breakdown: "border-red-300 bg-red-50 text-red-800",
  blocked: "border-red-200 bg-red-50 text-red-800",
  inactive: "border-slate-200 bg-slate-50 text-slate-500 opacity-70",
};
