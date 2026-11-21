/** Job statuses as shown on screen (brief section 5.3). */
export const JOB_STATUS_UI = {
  TO_PLAN: { label: "To plan", className: "border-amber-300 bg-amber-50 text-amber-900" },
  PLANNED: { label: "Planned", className: "border-blue-200 bg-blue-50 text-blue-900" },
  RUNNING: { label: "Running", className: "border-emerald-300 bg-emerald-50 text-emerald-900" },
  ON_HOLD: { label: "On hold", className: "border-orange-300 bg-orange-50 text-orange-900" },
  DONE: { label: "Done", className: "border-slate-200 bg-slate-100 text-slate-700" },
  HANDED_OVER: { label: "Handed over", className: "border-slate-200 bg-white text-slate-600" },
  CANCELLED: { label: "Cancelled", className: "border-slate-200 bg-white text-slate-400 line-through" },
} as const;
export type JobStatusName = keyof typeof JOB_STATUS_UI;
