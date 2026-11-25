"use client";

import { LogOut, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { floorSignOutAction } from "@/lib/actions/floor";

const IDLE_MS = 10 * 60_000;

type Floor = { name: string; finished: () => void };
const FloorContext = createContext<Floor | null>(null);

/** Set only during a PIN session on a shared shop-floor device. */
export function useFloor() {
  return useContext(FloorContext);
}

/**
 * A PIN session: ends after the operator's action (Today calls finished()), or after 10 minutes
 * without a tap or key press. The server also refuses a session 10 minutes after its last action.
 */
export function FloorProvider({ name, children }: { name: string; children: React.ReactNode }) {
  const router = useRouter();
  const [, start] = useTransition();
  const ended = useRef(false);
  const finished = useCallback(() => {
    if (ended.current) return;
    ended.current = true;
    start(async () => {
      await floorSignOutAction();
      router.replace("/floor");
      router.refresh();
    });
  }, [router]);

  useEffect(() => {
    let timer = window.setTimeout(finished, IDLE_MS);
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(finished, IDLE_MS);
    };
    const events = ["pointerdown", "keydown", "scroll", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    return () => {
      window.clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [finished]);

  return <FloorContext value={{ name, finished }}>{children}</FloorContext>;
}

/** Top-right on a shared device instead of the account menu. */
export function FloorBar({ name }: { name: string }) {
  return (
    <FloorProvider name={name}>
      <FloorDoneButton />
    </FloorProvider>
  );
}

/** "Done, back to Today" inside a FloorProvider. */
export function FloorDoneButton() {
  const floor = useFloor()!;
  return (
    <div className="flex items-center gap-2">
      <span className="hidden items-center gap-1.5 text-sm font-medium sm:flex">
        <UserRound className="size-4 text-primary" aria-hidden /> {floor.name}
      </span>
      <Button size="sm" variant="outline" onClick={floor.finished}>
        <LogOut aria-hidden /> Done, back to Today
      </Button>
    </div>
  );
}
