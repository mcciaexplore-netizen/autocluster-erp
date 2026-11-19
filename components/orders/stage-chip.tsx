import { STAGE_INFO, type ChipTone, type Stage } from "@/lib/tickets";
import { cn } from "@/lib/utils";

export const TONE_CLASS: Record<ChipTone, string> = {
  grey: "border-slate-200 bg-slate-100 text-slate-700",
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  red: "border-red-200 bg-red-50 text-red-700",
  blue: "border-sky-200 bg-sky-50 text-sky-800",
  green: "border-emerald-200 bg-emerald-50 text-emerald-800",
};

const STAGE_TONE: Record<Stage, ChipTone> = { WAITING_PO: "grey", BILLING: "amber", PAYMENT: "blue", PAID: "green", CANCELLED: "red" };

export function ToneChip({ tone, children, className }: { tone: ChipTone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-sm font-medium whitespace-nowrap", TONE_CLASS[tone], className)}>
      {children}
    </span>
  );
}

export function StageChip({ stage }: { stage: Stage }) {
  return <ToneChip tone={STAGE_TONE[stage]}>{stage === "CANCELLED" ? "Cancelled" : STAGE_INFO[stage].title}</ToneChip>;
}
