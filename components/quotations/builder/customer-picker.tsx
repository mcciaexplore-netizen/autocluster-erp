"use client";

import { Check, ChevronsUpDown, Search } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CATEGORY_LABELS, type Category } from "@/lib/pricing";
import { cn } from "@/lib/utils";

export interface PickerCustomer {
  id: string;
  companyName: string;
  pocName: string;
  pocPhone: string;
  gstin: string | null;
  city: string;
  category: Category;
  isMcciaMember: boolean;
}

/** Searchable dropdown: type company name, contact person or GST number. */
export function CustomerPicker({
  customers,
  value,
  onChange,
}: {
  customers: PickerCustomer[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = customers.find((c) => c.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Choose customer"
          className="h-14 w-full justify-between bg-card px-4 text-left text-base font-normal"
        >
          {selected ? (
            <span className="truncate font-medium text-primary">{selected.companyName}</span>
          ) : (
            <span className="flex items-center gap-2 text-muted-foreground">
              <Search className="size-5" aria-hidden /> Type company name, contact person or GST number
            </span>
          )}
          <ChevronsUpDown className="size-5 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-[min(100vw-2rem,24rem)] p-0" align="start">
        <Command
          filter={(itemValue, search) => (itemValue.toLowerCase().includes(search.toLowerCase().trim()) ? 1 : 0)}
        >
          <CommandInput placeholder="Search customers" />
          <CommandList>
            <CommandEmpty>No customer found. Use “Add new customer” below the box.</CommandEmpty>
            <CommandGroup>
              {customers.map((c) => (
                <CommandItem
                  key={c.id}
                  value={`${c.companyName} ${c.pocName} ${c.gstin ?? ""} ${c.pocPhone} ${c.id}`}
                  onSelect={() => {
                    onChange(c.id);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("size-5", value === c.id ? "opacity-100" : "opacity-0")} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{c.companyName}</div>
                    <div className="truncate text-sm text-muted-foreground">
                      {c.pocName} · {c.city} · {CATEGORY_LABELS[c.category]}
                      {c.isMcciaMember ? " · MCCIA Member" : ""}
                    </div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
