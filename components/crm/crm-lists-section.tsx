"use client";

import { ArrowDown, ArrowUp, Check, ListChecks, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useConfirm } from "@/components/common/confirm";
import { FormSection } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { addCrmListItem, deleteCrmListItem, moveCrmListItem, setCrmListItemActive, updateCrmListItem } from "@/lib/actions/crm-settings";
import type { CrmListItem, CrmLists } from "@/lib/crm-data";
import { cn } from "@/lib/utils";

type Key = "sources" | "lostReasons" | "tags" | "team" | "invCategories" | "invUnits" | "invPurposes" | "invReasons";
type ListConfig = { key: Key; tab: string; one: string; help: string; example: string };

const LISTS: ListConfig[] = [
  { key: "sources", tab: "Sources", one: "source", help: "Where enquiries come from. Every enquiry needs one.", example: "e.g. LinkedIn" },
  { key: "lostReasons", tab: "Lost reasons", one: "lost reason", help: "Asked for when an enquiry is marked as lost.", example: "e.g. Delivery time too long" },
  { key: "tags", tab: "Tags", one: "tag", help: "Optional labels to group enquiries.", example: "e.g. Export" },
  { key: "team", tab: "Team members", one: "team member", help: "People enquiries and activities can be assigned to. Names only, these are not sign-in accounts.", example: "e.g. Sneha Joshi" },
];

const INV_LISTS: ListConfig[] = [
  { key: "invCategories", tab: "Categories", one: "category", help: "Every item belongs to one category.", example: "e.g. Packing material" },
  { key: "invUnits", tab: "Units", one: "unit", help: "The unit stock is counted in, e.g. ml or pcs.", example: "e.g. roll" },
  { key: "invPurposes", tab: "Internal use", one: "purpose", help: "Asked for when stock is used for something other than a job.", example: "e.g. Calibration" },
  { key: "invReasons", tab: "Adjust reasons", one: "reason", help: "Asked for when stock is added or removed by hand.", example: "e.g. Returned to supplier" },
];

/** Settings > CRM lists: add, rename, reorder, hide and delete. Each change saves straight away. */
export function CrmListsSection({ lists }: { lists: CrmLists }) {
  return (
    <ListsSection
      title="CRM lists"
      description="Each change is saved straight away. Items already used on an enquiry are hidden instead of deleted."
      configs={LISTS}
      lists={lists as unknown as Record<Key, CrmListItem[]>}
    />
  );
}

/** Settings > Inventory lists: categories, units, internal use purposes, adjustment reasons. */
export function InventoryListsSection({ lists }: { lists: Record<"invCategories" | "invUnits" | "invPurposes" | "invReasons", CrmListItem[]> }) {
  return (
    <ListsSection
      title="Inventory lists"
      description="Each change is saved straight away. Items already in use are hidden instead of deleted, so old records keep them."
      configs={INV_LISTS}
      lists={lists as Record<Key, CrmListItem[]>}
    />
  );
}

function ListsSection({ title, description, configs, lists }: { title: string; description: string; configs: ListConfig[]; lists: Record<Key, CrmListItem[]> }) {
  return (
    <FormSection title={title} description={description} icon={<ListChecks className="size-5" />}>
      <Tabs defaultValue={configs[0].key}>
        <TabsList className="grid w-full grid-cols-2 group-data-horizontal/tabs:h-auto sm:flex sm:justify-start">
          {configs.map((l) => (
            <TabsTrigger key={l.key} value={l.key}>
              {l.tab} <span className="text-muted-foreground">({lists[l.key].filter((i) => i.isActive).length})</span>
            </TabsTrigger>
          ))}
        </TabsList>
        {configs.map((l) => (
          <TabsContent key={l.key} value={l.key} className="mt-4">
            <p className="mb-3 text-sm text-muted-foreground">{l.help}</p>
            <ListEditor listKey={l.key} one={l.one} example={l.example} items={lists[l.key]} />
          </TabsContent>
        ))}
      </Tabs>
    </FormSection>
  );
}

function ListEditor({ listKey, one, example, items }: { listKey: Key; one: string; example: string; items: CrmListItem[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [dialog, confirm] = useConfirm();
  const team = listKey === "team";
  const [draft, setDraft] = useState({ name: "", phone: "", email: "" });

  const act = (fn: () => Promise<{ ok: boolean; message?: string; data?: unknown }>, done?: (data: unknown) => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.message);
      done?.(r.data);
      router.refresh();
    });

  const add = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!draft.name.trim()) return void toast.error(`Please enter a name for the ${one}.`);
    act(
      () => addCrmListItem(listKey, draft),
      () => {
        setDraft({ name: "", phone: "", email: "" });
        toast.success(`Added "${draft.name.trim()}"`);
      },
    );
  };

  const remove = async (it: CrmListItem) => {
    if (!(await confirm({ title: `Delete "${it.name}"?`, description: `If any enquiry already uses this ${one}, it will be hidden instead, so old enquiries keep it.`, confirmLabel: "Delete", destructive: true }))) return;
    act(
      () => deleteCrmListItem(listKey, it.id),
      (d) => toast.success(d === "hidden" ? `"${it.name}" is in use, so it was hidden instead.` : `Deleted "${it.name}"`),
    );
  };

  return (
    <div className="flex flex-col gap-3">
      {dialog}
      <ul className="divide-y rounded-xl border" aria-busy={pending}>
        {items.length === 0 ? <li className="p-4 text-sm text-muted-foreground">Nothing here yet. Add the first one below.</li> : null}
        {items.map((it, i) => (
          <Row
            key={it.id}
            item={it}
            team={team}
            first={i === 0}
            last={i === items.length - 1}
            pending={pending}
            onMove={(dir) => act(() => moveCrmListItem(listKey, it.id, dir))}
            onActive={(v) => act(() => setCrmListItemActive(listKey, it.id, v))}
            onSave={(v, close) => act(() => updateCrmListItem(listKey, it.id, v), close)}
            onDelete={() => remove(it)}
          />
        ))}
      </ul>
      <form onSubmit={add} className="flex flex-col gap-2 rounded-xl border border-dashed p-3 sm:flex-row sm:flex-wrap sm:items-center">
        <Input aria-label={`New ${one} name`} placeholder={`New ${one}, ${example}`} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="min-w-0 sm:flex-1" maxLength={60} />
        {team ? (
          <>
            <Input aria-label="Mobile (optional)" placeholder="Mobile (optional)" type="tel" inputMode="numeric" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} className="min-w-0 sm:w-44" />
            <Input aria-label="Email (optional)" placeholder="Email (optional)" type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} className="min-w-0 sm:w-56" />
          </>
        ) : null}
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />} Add
        </Button>
      </form>
    </div>
  );
}

function Row({
  item,
  team,
  first,
  last,
  pending,
  onMove,
  onActive,
  onSave,
  onDelete,
}: {
  item: CrmListItem;
  team: boolean;
  first: boolean;
  last: boolean;
  pending: boolean;
  onMove: (dir: -1 | 1) => void;
  onActive: (v: boolean) => void;
  onSave: (v: { name: string; phone: string; email: string }, close: () => void) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState({ name: item.name, phone: item.phone ?? "", email: item.email ?? "" });

  if (editing) {
    return (
      <li className="p-3">
        <form
          className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center"
          onSubmit={(e) => {
            e.preventDefault();
            onSave(v, () => setEditing(false));
          }}
        >
          <Input aria-label="Name" autoFocus value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} className="min-w-0 sm:flex-1" maxLength={60} />
          {team ? (
            <>
              <Input aria-label="Mobile (optional)" placeholder="Mobile (optional)" type="tel" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} className="min-w-0 sm:w-44" />
              <Input aria-label="Email (optional)" placeholder="Email (optional)" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} className="min-w-0 sm:w-56" />
            </>
          ) : null}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              <Check aria-hidden /> Save
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              <X aria-hidden /> Cancel
            </Button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 p-2 pl-4", !item.isActive && "bg-muted/40")}>
      <div className="min-w-0 basis-full sm:basis-auto sm:flex-1">
        <p className={cn("truncate font-medium", !item.isActive && "text-muted-foreground line-through decoration-1")}>{item.name}</p>
        {team && (item.phone || item.email) ? <p className="truncate text-sm text-muted-foreground">{[item.phone && `+91 ${item.phone}`, item.email].filter(Boolean).join(" · ")}</p> : null}
      </div>
      <label className="mr-auto flex items-center gap-2 text-sm text-muted-foreground sm:mr-0">
        <Switch checked={item.isActive} onCheckedChange={onActive} disabled={pending} aria-label={`Show "${item.name}" in lists`} />
        {item.isActive ? "Shown" : "Hidden"}
      </label>
      <div className="flex">
        <Button type="button" size="icon-sm" variant="ghost" disabled={first || pending} onClick={() => onMove(-1)} aria-label={`Move "${item.name}" up`}>
          <ArrowUp aria-hidden />
        </Button>
        <Button type="button" size="icon-sm" variant="ghost" disabled={last || pending} onClick={() => onMove(1)} aria-label={`Move "${item.name}" down`}>
          <ArrowDown aria-hidden />
        </Button>
        <Button type="button" size="icon-sm" variant="ghost" onClick={() => {
            setV({ name: item.name, phone: item.phone ?? "", email: item.email ?? "" });
            setEditing(true);
          }} aria-label={`Rename "${item.name}"`}>
          <Pencil aria-hidden />
        </Button>
        <Button type="button" size="icon-sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={pending} onClick={onDelete} aria-label={`Delete "${item.name}"`}>
          <Trash2 aria-hidden />
        </Button>
      </div>
    </li>
  );
}
