"use client";

import { CalendarClock, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { earliestSlotForServiceAction } from "@/lib/actions/jobs";

type Hint = { none: true } | { none: false; start: string; machine: string; assumed: boolean } | null;
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
  const day = fmt.format(new Date(hint.start)).replace(",", "");
  if (hint.assumed)
    return (
      <p className="mt-2 inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900">
        <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
        Earliest free slot: {day} (time not set on Rate Card, assuming 1 h)
        <Link href={`/rate-card?time=${serviceId}`} target="_blank" className="underline underline-offset-2 hover:text-amber-950">
          Set the time
        </Link>
      </p>
    );
  return (
    <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-900">
      <CalendarClock className="size-3.5 shrink-0" aria-hidden />
      Earliest free slot: {day} ({hint.machine})
    </p>
  );
}
