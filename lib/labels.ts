export const QUOTE_STATUS = {
  DRAFT: { label: "Draft", className: "bg-slate-100 text-slate-700 border-slate-200" },
  SENT: { label: "Sent", className: "bg-amber-50 text-amber-800 border-amber-200" },
  ACCEPTED: { label: "Accepted", className: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  REJECTED: { label: "Rejected", className: "bg-red-50 text-red-700 border-red-200" },
} as const;
export type QuoteStatus = keyof typeof QUOTE_STATUS;
export const QUOTE_STATUSES = Object.keys(QUOTE_STATUS) as QuoteStatus[];
