/** The colours of a booking (Timeline legend): shared by the Timeline, the Department board and machine pages. */
export function bookingColour(b: { holdExpired?: boolean; tentative?: boolean; status: string }): string {
  const done = ["DONE", "HANDED_OVER"].includes(b.status);
  return b.holdExpired
    ? "border-red-500 bg-red-100 text-red-950"
    : b.tentative
      ? "border-amber-400 bg-[repeating-linear-gradient(135deg,#fffbeb_0_6px,#fde68a_6px_12px)] text-amber-950"
      : b.status === "RUNNING"
        ? "border-emerald-500 bg-emerald-200 text-emerald-950"
        : done
          ? "border-slate-300 bg-slate-200 text-slate-700"
          : "border-blue-400 bg-blue-200 text-blue-950";
}

/** Blocked time (maintenance, breakdown...): grey stripes. */
export const BLOCKED_STYLE = "border-slate-400 bg-[repeating-linear-gradient(135deg,#e2e8f0_0_4px,#cbd5e1_4px_8px)] text-slate-700";
