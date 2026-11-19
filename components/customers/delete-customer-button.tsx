"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { deleteCustomer, restoreCustomer } from "@/lib/actions/customers";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export function DeleteCustomerButton({
  id,
  companyName,
  redirectTo,
  size = "default",
}: {
  id: string;
  companyName: string;
  redirectTo?: string;
  size?: "default" | "sm";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const onDelete = () =>
    startTransition(async () => {
      await deleteCustomer(id);
      setOpen(false);
      toast.success(`${companyName} deleted`, {
        duration: 5000,
        action: {
          label: "Undo",
          onClick: async () => {
            await restoreCustomer(id);
            toast.success(`${companyName} is back`);
            if (redirectTo) router.push(`/customers/${id}`);
            router.refresh();
          },
        },
      });
      if (redirectTo) router.push(redirectTo);
      router.refresh();
    });

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size={size}>
          <Trash2 aria-hidden /> Delete
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {companyName}?</AlertDialogTitle>
          <AlertDialogDescription className="text-base">
            The customer will be removed from your lists. Quotations already made for them are kept. You can undo this for a few seconds.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep customer</AlertDialogCancel>
          <AlertDialogAction onClick={(e) => { e.preventDefault(); onDelete(); }} disabled={pending} className="bg-destructive text-white hover:bg-destructive/90">
            Yes, delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
