"use client";

import { useCallback, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export interface ConfirmOptions {
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Only an OK button (for explaining why something can't be done). */
  infoOnly?: boolean;
  destructive?: boolean;
}

/** `const [dialog, confirm] = useConfirm(); if (await confirm({...})) ...` and render {dialog}. */
export function useConfirm(): [React.ReactNode, (o: ConfirmOptions) => Promise<boolean>] {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback((o: ConfirmOptions) => {
    setOpts(o);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = (v: boolean) => {
    resolver.current?.(v);
    resolver.current = null;
    setOpts(null);
  };

  const dialog = (
    <AlertDialog open={!!opts} onOpenChange={(o) => !o && close(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{opts?.title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="text-base">{opts?.description}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          {opts?.infoOnly ? null : <AlertDialogCancel onClick={() => close(false)}>{opts?.cancelLabel ?? "Cancel"}</AlertDialogCancel>}
          <AlertDialogAction
            onClick={() => close(!opts?.infoOnly)}
            className={opts?.destructive ? "bg-destructive text-white hover:bg-destructive/90" : undefined}
          >
            {opts?.infoOnly ? "OK" : (opts?.confirmLabel ?? "Continue")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  return [dialog, confirm];
}
