import { Suspense } from "react";
import { PlanningTabs } from "@/components/planning/planning-tabs";

export default function PlanningLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <Suspense fallback={<div className="mb-6 h-12 rounded-xl bg-secondary" />}>
        <PlanningTabs />
      </Suspense>
      {children}
    </div>
  );
}
