"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { crmVersionAction } from "@/lib/actions/crm";

/**
 * Keeps the CRM screens up to date without reloading: every few seconds (only while the
 * tab is visible) it asks whether anything changed, and refreshes the data if so.
 */
export function useLiveRefresh(everyMs = 8000) {
  const router = useRouter();
  useEffect(() => {
    let last: string | null = null;
    let stopped = false;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      const v = await crmVersionAction().catch(() => null);
      if (stopped || v == null) return;
      if (last != null && v !== last) router.refresh();
      last = v;
    };
    void check();
    const t = setInterval(check, everyMs);
    const onVisible = () => void check();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, everyMs]);
}
