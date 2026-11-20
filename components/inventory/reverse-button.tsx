"use client";

import { Loader2, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Field } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { reverseDocumentAction } from "@/lib/actions/stock";
import { DoneBySelect, useDoneBy } from "./pickers";

export function ReverseButton({ docId, docNo, team }: { docId: string; docNo: string; team: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const [doneBy, setDoneBy] = useDoneBy(team);
  const [pending, start] = useTransition();
  const error = reason.trim().length < 3 ? "Please write a short reason." : undefined;
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Undo2 aria-hidden /> Reverse
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form
            noValidate
            className="flex flex-col gap-5"
            onSubmit={(e) => {
              e.preventDefault();
              setTouched(true);
              if (error) return;
              start(async () => {
                const r = await reverseDocumentAction(docId, reason, doneBy || null);
                if (!r.ok) return void toast.error(r.message);
                toast.success(`${docNo} reversed by ${r.data.docNo}`);
                setOpen(false);
                router.push(`/inventory/movements/${r.data.id}`);
                router.refresh();
              });
            }}
          >
            <DialogHeader>
              <DialogTitle>Reverse {docNo}?</DialogTitle>
              <DialogDescription>An opposite record is added, linked to this one, so stock and value go back exactly. Both stay in the history. Then enter the right record again.</DialogDescription>
            </DialogHeader>
            <Field label="Reason" required helper="e.g. Wrong quantity entered" error={touched ? error : undefined}>
              {(p) => <Textarea {...p} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} autoFocus />}
            </Field>
            <Field label="Done by" optional>
              {(p) => <DoneBySelect id={p.id} team={team} value={doneBy} onChange={setDoneBy} />}
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Keep it
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Undo2 aria-hidden />} Reverse it
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
