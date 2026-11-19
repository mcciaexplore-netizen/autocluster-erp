"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useConfirm } from "@/components/common/confirm";
import { moveLeadAction } from "@/lib/actions/crm";
import { LostDialog } from "./lost-dialog";

type MovableLead = { id: string; title: string; stageId: string };
type StageLite = { id: string; name: string; type: "OPEN" | "WON" | "LOST" };

/**
 * One place for the stage-move rules, used by the board, the stage bar and the buttons:
 * - Lost opens the reason form; the enquiry only moves once a reason is saved.
 * - Won moves it, then asks "Make [Company] a customer now?" (when it isn't one yet).
 * - Won/Lost back to an open stage reopens it.
 */
export function useLeadMove({ stages, lostReasons, onMoved }: { stages: StageLite[]; lostReasons: { id: string; name: string }[]; onMoved?: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [dialog, confirm] = useConfirm();
  const [lost, setLost] = useState<{ lead: MovableLead; stageId: string; hooks?: Hooks } | null>(null);

  type Hooks = { optimistic?: () => void; revert?: () => void };

  const askConvert = async (leadId: string, company: string) => {
    const yes = await confirm({
      title: `Make ${company} a customer now?`,
      description: "You'll get the customer form with the enquiry's details filled in. Add the address, GST and PAN, then save.",
      confirmLabel: "Yes, convert",
      cancelLabel: "Later",
    });
    if (yes) router.push(`/customers/new?lead=${leadId}`);
  };

  const doMove = (l: MovableLead, stageId: string, lostInfo?: { reasonId: string; note: string }, hooks?: Hooks) =>
    start(async () => {
      hooks?.optimistic?.();
      const r = await moveLeadAction(l.id, stageId, lostInfo);
      if (!r.ok) {
        hooks?.revert?.();
        return void toast.error(r.message);
      }
      setLost(null);
      router.refresh();
      onMoved?.();
      const d = r.data;
      if (!d.changed) return;
      if (d.toType === "WON") {
        toast.success(`“${l.title}” is won`);
        if (!d.customerId) void askConvert(d.leadId, d.companyName);
      } else if (d.toType === "LOST") toast.success(`“${l.title}” marked as lost`);
      else if (d.fromType !== "OPEN") toast.success(`“${l.title}” reopened in ${d.toName}`);
      else toast.success(`Moved to ${d.toName}`);
    });

  const moveTo = (l: MovableLead, stageId: string, hooks?: Hooks) => {
    if (stageId === l.stageId) return;
    const to = stages.find((s) => s.id === stageId);
    if (!to) return void toast.error("That stage no longer exists. Please refresh the page.");
    if (to.type === "LOST") return setLost({ lead: l, stageId, hooks });
    doMove(l, stageId, undefined, hooks);
  };

  const markWon = (l: MovableLead) => {
    const won = stages.find((s) => s.type === "WON");
    if (won) moveTo(l, won.id);
  };
  const markLost = (l: MovableLead) => {
    const st = stages.find((s) => s.type === "LOST");
    if (st) moveTo(l, st.id);
  };

  const elements = (
    <>
      {dialog}
      <LostDialog
        open={!!lost}
        title={`Mark “${lost?.lead.title ?? ""}” as lost?`}
        reasons={lostReasons}
        pending={pending}
        onCancel={() => setLost(null)}
        onConfirm={(v) => lost && doMove(lost.lead, lost.stageId, v, lost.hooks)}
      />
    </>
  );

  return { moveTo, markWon, markLost, pending, elements, confirm };
}
