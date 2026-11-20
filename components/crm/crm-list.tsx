"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, Handshake, Tag, Trash2, UserRound, ArrowLeftRight, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { useConfirm } from "@/components/common/confirm";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { bulkAddTagAction, bulkAssignAction, bulkMoveAction, deleteLeadsAction, restoreLeadsAction } from "@/lib/actions/crm";
import type { BoardLead, BoardStage, LeadFormOptions } from "@/lib/crm-data";
import { LeadPanel } from "./lead-panel";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ACTIVITY_TYPES, activityDueLabel, activityStatus, matchesFilters, sortLeads, todayInIndia } from "@/lib/crm/leads";
import { stageColor } from "@/lib/crm/stages";
import { formatDate } from "@/lib/format";
import { formatINRShort } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import { CrmToolbar } from "./crm-toolbar";
import { StagePill } from "./lead-bits";
import { LostDialog } from "./lost-dialog";
import { useCrmFilters } from "./use-crm-filters";

type Col = "leadNo" | "title" | "company" | "contact" | "stage" | "value" | "close" | "activity" | "assigned" | "source" | "created";

const COLS: { key: Col; label: string; right?: boolean }[] = [
  { key: "leadNo", label: "Enquiry no." },
  { key: "title", label: "Title" },
  { key: "company", label: "Company" },
  { key: "contact", label: "Contact" },
  { key: "stage", label: "Stage" },
  { key: "value", label: "Expected value", right: true },
  { key: "close", label: "Expected close" },
  { key: "activity", label: "Next activity" },
  { key: "assigned", label: "Assigned to" },
  { key: "source", label: "Source" },
  { key: "created", label: "Created" },
];

const ACT_TEXT = { planned: "text-emerald-700", today: "text-amber-700 font-medium", overdue: "text-red-700 font-medium", none: "text-muted-foreground" } as const;

export function CrmList({ stages, leads, options: pickers }: { stages: BoardStage[]; leads: BoardLead[]; options: LeadFormOptions }) {
  const router = useRouter();
  const { filters, sort, set } = useCrmFilters();
  useAutoRefresh("crm");
  const refreshKey = useMemo(() => leads.map((l) => `${l.id}:${l.stageId}:${l.priority}:${l.nextActivity?.id ?? ""}`).join("|"), [leads]);
  const today = todayInIndia();
  const [pending, start] = useTransition();
  const [dialog, confirm] = useConfirm();
  const [col, setCol] = useState<{ key: Col; dir: 1 | -1 } | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [lostFor, setLostFor] = useState<string | null>(null);

  const stageIdx = useMemo(() => new Map(stages.map((s, i) => [s.id, i])), [stages]);
  const stageById = (id: string) => stages.find((s) => s.id === id)!;

  const rows = useMemo(() => {
    const list = sortLeads(leads.filter((l) => matchesFilters(l, filters, today)), sort);
    if (!col) return list;
    const val = (l: BoardLead): string | number => {
      switch (col.key) {
        case "leadNo":
          return l.leadNo;
        case "title":
          return l.title.toLowerCase();
        case "company":
          return l.companyName.toLowerCase();
        case "contact":
          return l.contactName.toLowerCase();
        case "stage":
          return stageIdx.get(l.stageId) ?? 0;
        case "value":
          return l.expectedValuePaise ?? -1;
        case "close":
          return l.expectedCloseDate ?? "9999";
        case "activity":
          return l.nextActivityDate ?? "9999";
        case "assigned":
          return (l.assignedToName ?? "~").toLowerCase();
        case "source":
          return l.sourceName.toLowerCase();
        case "created":
          return l.createdAt;
      }
    };
    return [...list].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * col.dir;
    });
  }, [leads, filters, sort, today, col, stageIdx]);

  // Only rows still shown count as ticked.
  const ids = rows.filter((r) => ticked.has(r.id)).map((r) => r.id);
  const allTicked = rows.length > 0 && rows.every((r) => ticked.has(r.id));
  const toggle = (id: string) => setTicked((t) => (t.has(id) ? new Set([...t].filter((x) => x !== id)) : new Set([...t, id])));

  const after = (msg: string) => {
    toast.success(msg);
    setTicked(new Set());
    router.refresh();
  };
  const plural = (n: number) => `${n} ${n === 1 ? "enquiry" : "enquiries"}`;

  const moveAll = (stageId: string, lost?: { reasonId: string; note: string }) => {
    if (stageById(stageId).type === "LOST" && !lost) return setLostFor(stageId);
    start(async () => {
      const r = await bulkMoveAction(ids, stageId, lost);
      if (!r.ok) return void toast.error(r.message);
      setLostFor(null);
      after(`Moved ${plural(r.data.moved)} to ${stageById(stageId).name}`);
    });
  };
  const assignAll = (memberId: string | null, name: string) =>
    start(async () => {
      const r = await bulkAssignAction(ids, memberId);
      if (!r.ok) return void toast.error(r.message);
      after(memberId ? `Assigned ${plural(ids.length)} to ${name}` : `Removed the assignee from ${plural(ids.length)}`);
    });
  const tagAll = (tagId: string, name: string) =>
    start(async () => {
      const r = await bulkAddTagAction(ids, tagId);
      if (!r.ok) return void toast.error(r.message);
      after(`Tag “${name}” added to ${plural(ids.length)}`);
    });
  const deleteAll = async () => {
    const chosen = ids;
    if (!(await confirm({ title: `Delete ${plural(chosen.length)}?`, description: "They are removed from the board and the list. You can undo this straight after.", confirmLabel: "Delete", destructive: true }))) return;
    start(async () => {
      const r = await deleteLeadsAction(chosen);
      if (!r.ok) return void toast.error(r.message);
      setTicked(new Set());
      router.refresh();
      toast.success(`Deleted ${plural(r.data.deleted)}`, {
        action: {
          label: "Undo",
          onClick: async () => {
            const u = await restoreLeadsAction(chosen);
            if (!u.ok) return void toast.error(u.message);
            router.refresh();
            toast.success(`Restored ${plural(u.data.restored)}`);
          },
        },
      });
    });
  };

  const header = (c: (typeof COLS)[number]) => {
    const on = col?.key === c.key;
    const Icon = on ? (col!.dir === 1 ? ArrowUp : ArrowDown) : ArrowUpDown;
    return (
      <th key={c.key} scope="col" aria-sort={on ? (col!.dir === 1 ? "ascending" : "descending") : "none"} className={cn("px-3 py-2.5 font-medium whitespace-nowrap", c.right && "text-right")}>
        <button
          type="button"
          onClick={() => setCol(on ? (col!.dir === 1 ? { key: c.key, dir: -1 } : null) : { key: c.key, dir: 1 })}
          className={cn("inline-flex items-center gap-1 rounded hover:text-primary", on && "text-primary")}
        >
          {c.label} <Icon className={cn("size-3.5", !on && "opacity-40")} aria-hidden />
        </button>
      </th>
    );
  };

  return (
    <>
      {dialog}
      <CrmToolbar view="list" pickers={pickers} onNew={() => set({ new: "1", lead: null, edit: null })} />

      {ids.length ? (
        <div className="sticky top-16 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-xl border bg-card p-2 shadow-md" aria-busy={pending}>
          <span className="px-2 font-medium">{ids.length} ticked</span>
          <BulkMenu icon={ArrowLeftRight} label="Change stage" items={stages.map((s) => ({ key: s.id, label: s.name, dot: stageColor(s.color).dot, onSelect: () => moveAll(s.id) }))} disabled={pending} />
          <BulkMenu
            icon={UserRound}
            label="Assign to"
            items={[...pickers.team.map((m) => ({ key: m.id, label: m.name, onSelect: () => assignAll(m.id, m.name) })), { key: "none", label: "Nobody", onSelect: () => assignAll(null, "") }]}
            disabled={pending}
          />
          <BulkMenu icon={Tag} label="Add tag" items={pickers.tags.map((t) => ({ key: t.id, label: t.name, onSelect: () => tagAll(t.id, t.name) }))} disabled={pending} />
          <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" disabled={pending} onClick={deleteAll}>
            <Trash2 aria-hidden /> Delete
          </Button>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setTicked(new Set())}>
            <X aria-hidden /> Clear ticks
          </Button>
        </div>
      ) : null}

      {leads.length === 0 ? (
        <EmptyState icon={Handshake} title="No enquiries yet" description="Add each phone call, walk-in, website or event enquiry, then follow it up from the board." />
      ) : (
        <div className="overflow-x-auto rounded-2xl border bg-card">
          <table className="w-full text-sm">
            <caption className="sr-only">Enquiries</caption>
            <thead className="border-b bg-secondary/50 text-left text-muted-foreground">
              <tr>
                <th scope="col" className="w-10 px-3 py-2.5">
                  <Checkbox checked={allTicked} onCheckedChange={(v) => setTicked(v ? new Set(rows.map((r) => r.id)) : new Set())} aria-label="Tick all shown enquiries" />
                </th>
                {COLS.map(header)}
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => {
                const st = stageById(l.stageId);
                const as = activityStatus(l.nextActivityDate, today);
                return (
                  <tr key={l.id} className={cn("border-b last:border-0 hover:bg-secondary/30", ticked.has(l.id) && "bg-primary/5")}>
                    <td className="px-3 py-2.5">
                      <Checkbox checked={ticked.has(l.id)} onCheckedChange={() => toggle(l.id)} aria-label={`Tick ${l.title}`} />
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">{l.leadNo}</td>
                    <td className="max-w-64 min-w-48 px-3 py-2.5 font-medium">
                      <button type="button" className="text-left hover:text-primary hover:underline" onClick={() => set({ lead: l.id, edit: null, new: null })}>
                        {l.title}
                      </button>
                    </td>
                    <td className="max-w-56 min-w-40 px-3 py-2.5">{l.companyName}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{l.contactName}</td>
                    <td className="px-3 py-2.5">
                      <StagePill name={st.name} color={st.color} className="text-xs" />
                      {st.type === "LOST" && l.lostReason ? <span className="block pt-0.5 text-xs text-muted-foreground">{l.lostReason}</span> : null}
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium whitespace-nowrap tabular-nums">{l.expectedValuePaise != null ? formatINRShort(l.expectedValuePaise) : "—"}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{l.expectedCloseDate ? formatDate(l.expectedCloseDate) : "—"}</td>
                    <td className={cn("px-3 py-2.5 whitespace-nowrap", ACT_TEXT[as])}>
                      {l.nextActivity ? `${ACTIVITY_TYPES[l.nextActivity.type]}, ${activityDueLabel(l.nextActivity.dueDate, today).replace(/^Due /, "").toLowerCase()}` : "None planned"}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{l.assignedToName ?? <span className="text-muted-foreground">Not assigned</span>}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{l.sourceName}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{formatDate(new Date(l.createdAt))}</td>
                  </tr>
                );
              })}
              {!rows.length ? (
                <tr>
                  <td colSpan={COLS.length + 1} className="p-6 text-center text-muted-foreground">
                    No enquiries match these filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-sm text-muted-foreground">
        Showing {rows.length} of {plural(leads.length)}.
      </p>

      <LeadPanel options={pickers} refreshKey={refreshKey} />
      <LostDialog
        open={!!lostFor}
        title={`Mark ${plural(ids.length)} as lost?`}
        reasons={pickers.lostReasons}
        pending={pending}
        onCancel={() => setLostFor(null)}
        onConfirm={(v) => lostFor && moveAll(lostFor, v)}
      />
    </>
  );
}

function BulkMenu({
  icon: Icon,
  label,
  items,
  disabled,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  items: { key: string; label: string; dot?: string; onSelect: () => void }[];
  disabled?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" disabled={disabled}>
          <Icon className="size-4" aria-hidden /> {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-56 overflow-y-auto">
        {items.length ? (
          items.map((i) => (
            <DropdownMenuItem key={i.key} className="h-10" onSelect={i.onSelect}>
              {i.dot ? <span className={cn("size-2.5 rounded-full", i.dot)} aria-hidden /> : null} {i.label}
            </DropdownMenuItem>
          ))
        ) : (
          <DropdownMenuItem disabled>Nothing to choose yet. Add some in Settings.</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
