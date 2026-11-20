import { Hammer } from "lucide-react";

/** Shown on Inventory pages that are built in a later step (only on the test version, never live). */
export function ComingNext({ what }: { what: string }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-dashed bg-card p-6 text-muted-foreground">
      <Hammer className="mt-0.5 size-5 shrink-0" aria-hidden />
      <p>{what}</p>
    </div>
  );
}
