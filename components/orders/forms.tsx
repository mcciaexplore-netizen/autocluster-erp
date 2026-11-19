"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import type { BlobEnv } from "@/lib/files";
import type { BoardTicket } from "@/lib/orders-data";
import { AddPoDialog } from "./add-po-dialog";
import { ExportBillingDialog, InvoiceDialog } from "./billing-dialogs";
import type { ActionKind } from "./types";

const COMING: Partial<Record<ActionKind, string>> = {
  reminder: "Payment reminders",
  note: "Follow-up notes",
  payment: "Recording payments",
};

/** Hosts the step forms (Add PO, invoice, payment...). */
export function BoardForms({
  action,
  tickets,
  uploadEnv,
  onClose,
  onDone,
}: {
  action: { kind: ActionKind; ticket: BoardTicket } | null;
  tickets: BoardTicket[];
  uploadEnv: BlobEnv;
  onClose: () => void;
  onDone: () => void;
}) {
  const label = action ? COMING[action.kind] : undefined;
  useEffect(() => {
    if (label) {
      toast.info(`${label} is being added next.`);
      onClose();
    }
  }, [label, onClose]);
  const pick = (k: ActionKind) => (action?.kind === k ? action.ticket : null);
  return (
    <>
      <AddPoDialog ticket={pick("addPo")} tickets={tickets} env={uploadEnv} onClose={onClose} onDone={onDone} />
      <ExportBillingDialog ticket={pick("exportBilling")} tickets={tickets} onClose={onClose} onDone={onDone} />
      <InvoiceDialog ticket={pick("invoice")} tickets={tickets} env={uploadEnv} onClose={onClose} onDone={onDone} />
    </>
  );
}
