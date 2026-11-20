import { cn } from "@/lib/utils";

export const DOC_TYPE = {
  IN: { label: "Stock received", className: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  OUT: { label: "Stock used", className: "border-sky-200 bg-sky-50 text-sky-800" },
  ADJ: { label: "Stock adjusted", className: "border-amber-300 bg-amber-50 text-amber-800" },
} as const;

export function DocTypeChip({ type, reversal }: { type: "IN" | "OUT" | "ADJ"; reversal?: boolean }) {
  const t = DOC_TYPE[type];
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", reversal ? "border-slate-300 bg-slate-100 text-slate-700" : t.className)}>
      {reversal ? `Reversal (${t.label.toLowerCase()})` : t.label}
    </span>
  );
}
