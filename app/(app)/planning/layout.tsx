import { Suspense } from "react";
import { AreaGate } from "@/components/auth/area-gate";
import { JobPanelHost } from "@/components/planning/job-panel";
import { PlanningTabs } from "@/components/planning/planning-tabs";
import { blobEnv } from "@/lib/blob";

export default function PlanningLayout({ children }: { children: React.ReactNode }) {
  return (
    <AreaGate perm="planning.view" area="Planning">
      <div className="min-w-0">
        <Suspense fallback={<div className="mb-6 h-12 rounded-xl bg-secondary" />}>
          <PlanningTabs />
        </Suspense>
        {children}
        {/* Any Planning page opens a job with ?job=<id>. */}
        <Suspense>
          <JobPanelHost env={blobEnv()} />
        </Suspense>
      </div>
    </AreaGate>
  );
}
