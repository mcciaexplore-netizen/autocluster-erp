"use client";

import { CalendarClock } from "lucide-react";
import { useEffect, useState } from "react";
import { earliestSlotForServiceAction } from "@/lib/actions/jobs";

type Hint = { none: true } | { none: false; start: string; machine: string } | null;
const cache = new Map<string, Hint>();
const fmt = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

/** "Earliest free slot: Thu 26 Nov (SLA - 3D Systems 7000 HD)" under a quotation line. Never blocks anything. */
export function SlotHint({ serviceId, billableQty }: { serviceId: number | null; billableQty: number }) {
  const key = `${serviceId}:${billableQty}`;
  const [loaded, setLoaded] = useState<{ key: string; hint: Hint } | null>(null);
  useEffect(() => {
    if (serviceId == null || !(billableQty > 0) || cache.has(key)) return;
    let live = true;
    const t = setTimeout(() => {
      earliestSlotForServiceAction(serviceId, billableQty).then((h) => {
        cache.set(key, h);
        if (live) setLoaded({ key, hint: h });
      });
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [key, serviceId, billableQty]);
  const hint = cache.get(key) ?? (loaded?.key === key ? loaded.hint : undefined);
  if (serviceId == null || !hint || hint.none) return null;
  return (
    <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-900">
      <CalendarClock className="size-3.5 shrink-0" aria-hidden />
      Earliest free slot: {fmt.format(new Date(hint.start)).replace(",", "")} ({hint.machine})
    </p>
  );
}
