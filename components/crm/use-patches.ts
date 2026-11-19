"use client";

import { useState } from "react";

/**
 * Small optimistic changes keyed by id, thrown away as soon as `source`
 * (the data from the server) changes. No effects needed.
 */
export function usePatches<P extends object>(source: unknown) {
  const [st, setSt] = useState<{ src: unknown; map: Record<string, P> }>({ src: source, map: {} });
  const map = st.src === source ? st.map : {};
  const patch = (id: string, p: P) =>
    setSt((s) => {
      const cur = s.src === source ? s.map : {};
      return { src: source, map: { ...cur, [id]: { ...cur[id], ...p } } };
    });
  return [map, patch] as const;
}
