import { Skeleton } from "@/components/ui/skeleton";
import type { CrmStage } from "@/db/schema";

export function boardStage(s: CrmStage) {
  return { id: s.id, name: s.name, color: s.color, type: s.type, probability: s.probability, isFolded: s.isFolded };
}

export function CrmSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-11 w-48 rounded-xl" />
      <Skeleton className="h-12 rounded-xl" />
      <div className="flex gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-[60vh] w-72 shrink-0 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
