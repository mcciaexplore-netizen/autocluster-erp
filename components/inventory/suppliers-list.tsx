"use client";

import { Search, Store } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/common/empty-state";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/format";
import { formatINRShort } from "@/lib/pricing";
import { cn } from "@/lib/utils";

type Row = { id: string; name: string; contactName: string | null; phone: string | null; email: string | null; isActive: boolean; itemCount: number; boughtThisYearPaise: number; lastReceivedOn: string | null };

export function SuppliersList({ rows }: { rows: Row[] }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => rows.filter((r) => `${r.name} ${r.contactName ?? ""} ${r.phone ?? ""} ${r.email ?? ""}`.toLowerCase().includes(q.trim().toLowerCase())), [rows, q]);
  if (!rows.length) return <EmptyState icon={Store} title="No suppliers yet" description="Add the companies you buy materials from." />;
  return (
    <>
      <div className="relative mb-4">
        <label htmlFor="sup-search" className="sr-only">
          Search suppliers
        </label>
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input id="sup-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, contact, mobile or email" className="h-12 pl-11" />
      </div>
      <ul className="divide-y rounded-2xl border bg-card">
        {shown.map((r) => (
          <li key={r.id}>
            <Link href={`/inventory/suppliers/${r.id}`} className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-4 hover:bg-secondary/60", !r.isActive && "opacity-70")}>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-primary">
                  {r.name}
                  {!r.isActive ? <span className="ml-2 text-xs font-normal text-muted-foreground">(inactive)</span> : null}
                </span>
                <span className="block text-sm text-muted-foreground">{[r.contactName, r.phone ? `+91 ${r.phone}` : null, r.email].filter(Boolean).join(" · ") || "No contact details"}</span>
              </span>
              <span className="text-sm text-muted-foreground">
                {r.itemCount} {r.itemCount === 1 ? "item" : "items"}
                {r.lastReceivedOn ? ` · last delivery ${formatDate(r.lastReceivedOn)}` : ""}
              </span>
              <span className="w-32 text-right">
                <span className="block font-semibold tabular-nums">{formatINRShort(r.boughtThisYearPaise)}</span>
                <span className="block text-xs text-muted-foreground">bought this year</span>
              </span>
            </Link>
          </li>
        ))}
        {!shown.length ? <li className="p-6 text-center text-muted-foreground">No suppliers match “{q}”.</li> : null}
      </ul>
    </>
  );
}
