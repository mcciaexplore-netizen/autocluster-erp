"use client";

import type { BlobEnv } from "@/lib/files";
import type { BoardTicket } from "@/lib/orders-data";
import { AddPoDialog } from "./add-po-dialog";
import { ExportBillingDialog, InvoiceDialog } from "./billing-dialogs";
import { NoteDialog, PaymentDialog, ReminderDialog } from "./payment-dialogs";
import type { ActionKind } from "./types";

const withInvoice = (t: BoardTicket | null) => (t?.invoice ? t : null);

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
  const pick = (k: ActionKind) => (action?.kind === k ? action.ticket : null);
  return (
    <>
      <AddPoDialog ticket={pick("addPo")} tickets={tickets} env={uploadEnv} onClose={onClose} onDone={onDone} />
      <ExportBillingDialog ticket={pick("exportBilling")} tickets={tickets} onClose={onClose} onDone={onDone} />
      <InvoiceDialog ticket={pick("invoice")} tickets={tickets} env={uploadEnv} onClose={onClose} onDone={onDone} />
      <PaymentDialog ticket={withInvoice(pick("payment"))} onClose={onClose} onDone={onDone} />
      <NoteDialog ticket={withInvoice(pick("note"))} onClose={onClose} onDone={onDone} />
      <ReminderDialog ticket={withInvoice(pick("reminder"))} onClose={onClose} onDone={onDone} />
    </>
  );
}
