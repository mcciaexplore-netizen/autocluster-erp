"use client";

import { useState } from "react";
import { DoneActivityDialog, PlanActivityDialog, type DoneFor, type PlanFor } from "./activity-dialogs";

/** Plan activity / Mark done / "Done, plan next", shared by the enquiry view, the board and the home page. */
export function useActivityFlow({ team, onChanged }: { team: { id: string; name: string }[]; onChanged: () => void }) {
  const [plan, setPlan] = useState<PlanFor | null>(null);
  const [done, setDone] = useState<DoneFor | null>(null);
  const elements = (
    <>
      <PlanActivityDialog
        plan={plan}
        team={team}
        onClose={() => setPlan(null)}
        onDone={() => {
          setPlan(null);
          onChanged();
        }}
      />
      <DoneActivityDialog
        activity={done}
        onClose={() => setDone(null)}
        onDone={(planNext) => {
          const a = done!;
          setDone(null);
          onChanged();
          if (planNext) setPlan({ leadId: a.leadId, title: a.title, assignedTo: a.assignedTo });
        }}
      />
    </>
  );
  return { openPlan: setPlan, openDone: setDone, elements };
}
