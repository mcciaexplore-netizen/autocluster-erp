import { BadgeCheck } from "lucide-react";
import { CATEGORY_LABELS, type Category } from "@/lib/pricing";
import { QUOTE_STATUS, type QuoteStatus } from "@/lib/labels";
import { cn } from "@/lib/utils";

const pill = "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-sm font-medium whitespace-nowrap";

export function CategoryBadge({ category }: { category: Category }) {
  return (
    <span className={cn(pill, category === "MSME" ? "border-sky-200 bg-sky-50 text-sky-800" : "border-indigo-200 bg-indigo-50 text-indigo-800")}>
      {CATEGORY_LABELS[category]}
    </span>
  );
}

export function MemberBadge({ className }: { className?: string }) {
  return (
    <span className={cn(pill, "border-highlight/50 bg-highlight/15 text-highlight-foreground", className)}>
      <BadgeCheck className="size-4" aria-hidden />
      MCCIA Member
    </span>
  );
}

export function DeptChip({ code, name }: { code: string; name?: string }) {
  return (
    <span className={cn(pill, "border-border bg-secondary text-primary")} title={name}>
      {name ? `${code} - ${name}` : code}
    </span>
  );
}

export function StatusChip({ status }: { status: QuoteStatus }) {
  const s = QUOTE_STATUS[status];
  return <span className={cn(pill, s.className)}>{s.label}</span>;
}

export function CustomRateTag() {
  return <span className={cn(pill, "border-highlight/50 bg-highlight/15 px-2 text-xs text-highlight-foreground")}>custom rate</span>;
}
