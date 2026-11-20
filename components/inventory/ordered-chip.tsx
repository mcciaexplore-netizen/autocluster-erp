import { cn } from "@/lib/utils";

const dayMonth = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" });
export const shortDate = (iso: string) => dayMonth.format(new Date(`${iso.slice(0, 10)}T00:00:00`));

/** "Ordered on 20 Nov from Deccan Resins", or red "Delivery late (ordered 12 Nov)" once the lead time has passed. */
export function OrderedChip({ on, supplierName, late, className }: { on: string; supplierName?: string | null; late: boolean; className?: string }) {
  return late ? (
    <span className={cn("rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-800 ring-1 ring-red-300", className)}>
      Delivery late (ordered {shortDate(on)}
      {supplierName ? ` from ${supplierName}` : ""})
    </span>
  ) : (
    <span className={cn("rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-900 ring-1 ring-sky-200", className)}>
      Ordered on {shortDate(on)}
      {supplierName ? ` from ${supplierName}` : ""}
    </span>
  );
}
