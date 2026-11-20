"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { changedSinceAction, type LiveScope } from "@/lib/actions/live";

const EVERY_MS = 30_000;
const IDLE_MS = 15 * 60_000;
const ACTIVITY = ["mousemove", "mousedown", "keydown", "touchstart", "wheel", "scroll"] as const;

/**
 * Keeps a board up to date without reloading the page:
 * - every 30 seconds it asks "has anything changed since the last check?" and only then
 *   reloads the data;
 * - only while the tab is visible (paused when hidden or minimised);
 * - stops after 15 minutes with no mouse or keyboard activity;
 * - checks straight away when the person comes back (tab shown again, or activity after idle).
 */
export function useAutoRefresh(scope: LiveScope) {
  const router = useRouter();
  useEffect(() => {
    let since: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastActive = Date.now();
    let idle = false;
    let busy = false;
    let stopped = false;

    const visible = () => document.visibilityState === "visible";
    const schedule = () => {
      clearTimeout(timer);
      if (stopped || idle || !visible()) return;
      timer = setTimeout(tick, EVERY_MS);
    };
    const check = async () => {
      if (busy || stopped) return;
      busy = true;
      try {
        const r = await changedSinceAction(scope, since);
        if (!r || stopped) return;
        if (since && r.changed) router.refresh();
        since = r.at;
      } catch {
        // Offline or the server is busy: try again next time.
      } finally {
        busy = false;
      }
    };
    const tick = async () => {
      if (Date.now() - lastActive >= IDLE_MS) {
        idle = true; // stop until the person comes back
        return;
      }
      await check();
      schedule();
    };
    const comeBack = () => {
      lastActive = Date.now();
      idle = false;
      void check().then(schedule);
    };
    const onActivity = () => {
      const wasIdle = idle;
      lastActive = Date.now();
      if (wasIdle && visible()) comeBack();
    };
    const onVisibility = () => {
      if (visible()) comeBack();
      else clearTimeout(timer); // paused while hidden
    };

    void check().then(schedule);
    document.addEventListener("visibilitychange", onVisibility);
    for (const e of ACTIVITY) window.addEventListener(e, onActivity, { passive: true });
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      for (const e of ACTIVITY) window.removeEventListener(e, onActivity);
    };
  }, [router, scope]);
}
