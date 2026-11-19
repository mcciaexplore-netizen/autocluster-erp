"use client";

import { Checkbox } from "@/components/ui/checkbox";
import type { BoardTicket } from "@/lib/orders-data";
import { formatINR } from "@/lib/pricing";

export interface ChecklistGroup {
  key: string;
  label: string;
  tickets: BoardTicket[];
}

/** Groups tickets by a label, putting the clicked card's group first. */
export function groupTickets(tickets: BoardTicket[], keyOf: (t: BoardTicket) => string, labelOf: (t: BoardTicket) => string, firstKey: string): ChecklistGroup[] {
  const m = new Map<string, ChecklistGroup>();
  for (const t of tickets) {
    const k = keyOf(t);
    const g = m.get(k) ?? { key: k, label: labelOf(t), tickets: [] };
    g.tickets.push(t);
    m.set(k, g);
  }
  return [...m.values()].sort((a, b) => (a.key === firstKey ? -1 : b.key === firstKey ? 1 : a.label.localeCompare(b.label)));
}

/** "This PO also covers" / "This invoice also covers" checklist. The clicked card is always included. */
export function ServiceChecklist({
  legend,
  groups,
  selected,
  selfId,
  onToggle,
}: {
  legend: string;
  groups: ChecklistGroup[];
  selected: Set<string>;
  selfId: string;
  onToggle: (id: string, on: boolean) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-base font-medium">{legend}</legend>
      {groups.map((g) => (
        <div key={g.key} className="rounded-xl border">
          <p className="border-b bg-muted/40 px-3 py-2 text-sm font-medium">{g.label}</p>
          <ul className="divide-y">
            {g.tickets.map((t) => {
              const self = t.id === selfId;
              return (
                <li key={t.id}>
                  <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5 text-sm has-[:disabled]:cursor-default">
                    <Checkbox className="mt-0.5" checked={selected.has(t.id)} disabled={self} onCheckedChange={(v) => onToggle(t.id, v === true)} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{t.description}</span>
                      <span className="block text-xs text-muted-foreground">
                        {t.ticketNo}
                        {self ? " · this card" : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-right tabular-nums">{formatINR(t.totalPaise)}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </fieldset>
  );
}

export function useToggleSet(setSelected: React.Dispatch<React.SetStateAction<Set<string>>>) {
  return (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
}
