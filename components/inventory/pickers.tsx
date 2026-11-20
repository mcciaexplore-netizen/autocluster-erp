"use client";

import { Check, ChevronsUpDown, Plus, Search } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { StockFormItem } from "@/lib/inventory-data";
import { formatQty } from "@/lib/inventory/numbers";
import { cn } from "@/lib/utils";

/** Searchable item list (name or code), with the stock shown next to each item. */
export function ItemPicker({
  items,
  value,
  onChange,
  label = "Item",
  invalid,
}: {
  items: StockFormItem[];
  value: string;
  onChange: (id: string) => void;
  label?: string;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const sel = items.find((i) => i.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={label}
          aria-invalid={invalid}
          className={cn("h-auto min-h-11 w-full justify-between gap-2 bg-card px-3 py-2 text-left font-normal whitespace-normal", invalid && "border-destructive")}
        >
          {sel ? (
            <span className="min-w-0">
              <span className="block truncate font-medium">{sel.name}</span>
              <span className="block text-xs text-muted-foreground">
                {sel.code} · in stock {formatQty(sel.qty, sel.unit)}
              </span>
            </span>
          ) : (
            <span className="flex items-center gap-2 text-muted-foreground">
              <Search className="size-4" aria-hidden /> Choose item
            </span>
          )}
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-[min(100vw-2rem,22rem)] p-0" align="start">
        <Command filter={(v, s) => (v.toLowerCase().includes(s.toLowerCase().trim()) ? 1 : 0)}>
          <CommandInput placeholder="Type item name or code" />
          <CommandList>
            <CommandEmpty>No item found. Add it under Items first.</CommandEmpty>
            <CommandGroup>
              {items.map((i) => (
                <CommandItem
                  key={i.id}
                  value={`${i.name} ${i.code} ${i.id}`}
                  onSelect={() => {
                    onChange(i.id);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("size-4", value === i.id ? "opacity-100" : "opacity-0")} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{i.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {i.code} · {formatQty(i.qty, i.unit)}
                    </span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Searchable supplier list with "+ Add new supplier". */
export function SupplierPicker({
  suppliers,
  value,
  onChange,
  onAddNew,
  invalid,
}: {
  suppliers: { id: string; name: string }[];
  value: string;
  onChange: (id: string) => void;
  onAddNew: () => void;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const sel = suppliers.find((s) => s.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" aria-expanded={open} aria-label="Supplier" aria-invalid={invalid} className={cn("h-11 w-full justify-between bg-card px-3 font-normal", invalid && "border-destructive")}>
          {sel ? <span className="truncate font-medium">{sel.name}</span> : <span className="text-muted-foreground">Choose supplier</span>}
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-[min(100vw-2rem,20rem)] p-0" align="start">
        <Command filter={(v, s) => (v.toLowerCase().includes(s.toLowerCase().trim()) ? 1 : 0)}>
          <CommandInput placeholder="Type supplier name" />
          <CommandList>
            <CommandEmpty>No supplier found.</CommandEmpty>
            <CommandGroup>
              {suppliers.map((s) => (
                <CommandItem
                  key={s.id}
                  value={`${s.name} ${s.id}`}
                  onSelect={() => {
                    onChange(s.id);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("size-4", value === s.id ? "opacity-100" : "opacity-0")} aria-hidden />
                  {s.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          <div className="border-t p-1">
            <Button
              type="button"
              variant="ghost"
              className="w-full justify-start"
              onClick={() => {
                setOpen(false);
                onAddNew();
              }}
            >
              <Plus aria-hidden /> Add new supplier
            </Button>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

const DONE_BY_KEY = "acdri-inv-done-by";
const subscribe = (cb: () => void) => {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
};
function readDoneBy() {
  try {
    return localStorage.getItem(DONE_BY_KEY) ?? "";
  } catch {
    return "";
  }
}

/** "Done by": the team list; remembers the last choice on this device. */
export function useDoneBy(team: { id: string; name: string }[]) {
  const remembered = useSyncExternalStore(subscribe, readDoneBy, () => "");
  const [picked, setPicked] = useState<string | null>(null);
  const value = picked ?? (team.some((t) => t.id === remembered) ? remembered : "");
  const set = (v: string) => {
    setPicked(v);
    try {
      localStorage.setItem(DONE_BY_KEY, v);
    } catch {}
  };
  return [value, set] as const;
}

export function DoneBySelect({ team, value, onChange, id }: { team: { id: string; name: string }[]; value: string; onChange: (v: string) => void; id?: string }) {
  const NONE = "none";
  return (
    <Select value={value || NONE} onValueChange={(v) => onChange(v === NONE ? "" : v)}>
      <SelectTrigger id={id} className="w-full" aria-label="Done by">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>Not chosen</SelectItem>
        {team.map((t) => (
          <SelectItem key={t.id} value={t.id}>
            {t.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
