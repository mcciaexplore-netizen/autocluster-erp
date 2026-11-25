"use client";

import { Download } from "lucide-react";
import Link from "next/link";
import { ClearFilters, useUrlFilters } from "@/components/common/filter-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ActivityRow, ActivityStats } from "@/lib/activity-data";

const ALL = "all";
const when = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });

function Filters({ users, areas }: { users: { id: string; name: string }[]; areas: string[] }) {
  const { params, set } = useUrlFilters();
  const qs = params.toString();
  return (
    <div className="mb-5 flex flex-wrap items-end gap-2">
      <Select value={params.get("user") ?? ALL} onValueChange={(v) => set("user", v === ALL ? null : v)}>
        <SelectTrigger className="h-10 w-48" aria-label="Person">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Everyone</SelectItem>
          {users.map((u) => (
            <SelectItem key={u.id} value={u.id}>
              {u.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={params.get("area") ?? ALL} onValueChange={(v) => set("area", v === ALL ? null : v)}>
        <SelectTrigger className="h-10 w-40" aria-label="Area">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All areas</SelectItem>
          {areas.map((a) => (
            <SelectItem key={a} value={a}>
              {a}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        From
        <Input type="date" className="h-10 w-40" value={params.get("from") ?? ""} onChange={(e) => set("from", e.target.value || null)} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        To
        <Input type="date" className="h-10 w-40" value={params.get("to") ?? ""} onChange={(e) => set("to", e.target.value || null)} />
      </label>
      <ClearFilters keys={["user", "area", "from", "to", "limit"]} />
      <Button asChild variant="outline" className="ml-auto h-10">
        <a href={`/api/activity/export${qs ? `?${qs}` : ""}`}>
          <Download aria-hidden /> Download as Excel
        </a>
      </Button>
    </div>
  );
}

function Who({ r }: { r: ActivityRow }) {
  return (
    <>
      {r.who}
      {r.forName ? <span className="text-muted-foreground"> for {r.forName}</span> : null}
    </>
  );
}

function Record({ r }: { r: ActivityRow }) {
  if (!r.record) return <span className="text-muted-foreground">-</span>;
  return r.href ? (
    <Link href={r.href} className="font-medium text-primary underline-offset-4 hover:underline">
      {r.record}
    </Link>
  ) : (
    <>{r.record}</>
  );
}

const size = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : b >= 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const day = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

function Stats({ s }: { s: ActivityStats }) {
  return (
    <p className="mb-4 rounded-xl border bg-secondary/50 px-4 py-3 text-sm text-muted-foreground">
      {s.entries.toLocaleString("en-IN")} {s.entries === 1 ? "entry" : "entries"} ({size(s.bytes)})
      {s.oldest ? `, oldest from ${day.format(new Date(s.oldest))}` : ""}. Kept for {s.months} months; sign-in attempts for {s.days} days.{" "}
      <Link href="/settings" className="font-medium text-primary underline-offset-4 hover:underline">
        Change
      </Link>
    </p>
  );
}

export function ActivityLog({ rows, more, limit, users, areas, stats }: { rows: ActivityRow[]; more: boolean; limit: number; users: { id: string; name: string }[]; areas: string[]; stats: ActivityStats }) {
  const { set } = useUrlFilters();
  return (
    <>
      <Stats s={stats} />
      <Filters users={users} areas={areas} />
      {!rows.length ? (
        <p className="rounded-2xl border bg-card p-6 text-center text-muted-foreground">Nothing recorded for these filters.</p>
      ) : (
        <>
          <ul className="flex flex-col gap-3 md:hidden">
            {rows.map((r) => (
              <li key={r.id} className="rounded-2xl border bg-card p-4 text-sm">
                <p className="font-medium">{r.summary}</p>
                <p className="mt-1 text-muted-foreground">
                  <Who r={r} /> · {r.area} · {when.format(new Date(r.at))}
                </p>
                {r.record ? (
                  <p className="mt-1">
                    <Record r={r} />
                  </p>
                ) : null}
                {r.ip ? <p className="mt-1 text-xs text-muted-foreground">IP address {r.ip}</p> : null}
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto rounded-2xl border bg-card md:block">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">When</th>
                  <th className="px-3 py-3 font-medium">Who</th>
                  <th className="px-3 py-3 font-medium">Area</th>
                  <th className="px-3 py-3 font-medium">What</th>
                  <th className="px-3 py-3 font-medium">Record</th>
                  <th className="px-3 py-3 font-medium">IP address</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground tabular-nums">{when.format(new Date(r.at))}</td>
                    <td className="px-3 py-3">
                      <Who r={r} />
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">{r.area}</td>
                    <td className="px-3 py-3">{r.summary}</td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <Record r={r} />
                    </td>
                    <td className="px-3 py-3 text-muted-foreground tabular-nums">{r.ip ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {more ? (
            <div className="mt-4 flex justify-center">
              <Button variant="outline" onClick={() => set("limit", String(Math.min(limit + 200, 5000)))}>
                Show more
              </Button>
            </div>
          ) : null}
        </>
      )}
    </>
  );
}
