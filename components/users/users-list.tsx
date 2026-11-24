"use client";

import Link from "next/link";
import { ChipGroup, ClearFilters, SearchBox, useUrlFilters } from "@/components/common/filter-bar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { UserRow, UserStatus } from "@/lib/users-data";
import { cn } from "@/lib/utils";

const STATUS: Record<UserStatus, { label: string; className: string }> = {
  ACTIVE: { label: "Active", className: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  NAME_ONLY: { label: "Name only", className: "border-slate-200 bg-slate-100 text-slate-700" },
  LOCKED: { label: "Locked", className: "border-amber-300 bg-amber-50 text-amber-900" },
  DEACTIVATED: { label: "Deactivated", className: "border-red-200 bg-red-50 text-red-800" },
};
const ALL = "all";
const when = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });

export function StatusChip({ status }: { status: UserStatus }) {
  return <span className={cn("rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap", STATUS[status].className)}>{STATUS[status].label}</span>;
}

function Filters({ roles, departments }: { roles: { id: number; name: string }[]; departments: { code: string; name: string }[] }) {
  const { params, set } = useUrlFilters();
  return (
    <div className="mb-5 flex flex-col gap-3">
      <SearchBox label="Search people" placeholder="Search by name, email or mobile" />
      <div className="flex flex-wrap items-center gap-2">
        <Select value={params.get("role") ?? ALL} onValueChange={(v) => set("role", v === ALL ? null : v)}>
          <SelectTrigger className="h-10 w-44" aria-label="Role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All roles</SelectItem>
            {roles.map((r) => (
              <SelectItem key={r.id} value={String(r.id)}>
                {r.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={params.get("dept") ?? ALL} onValueChange={(v) => set("dept", v === ALL ? null : v)}>
          <SelectTrigger className="h-10 w-44" aria-label="Department">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All departments</SelectItem>
            {departments.map((d) => (
              <SelectItem key={d.code} value={d.code}>
                {d.code}: {d.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ClearFilters keys={["q", "role", "dept", "status"]} />
      </div>
      <ChipGroup
        label="Status"
        name="status"
        options={(Object.keys(STATUS) as UserStatus[]).map((s) => ({ value: s.toLowerCase(), label: STATUS[s].label }))}
      />
    </div>
  );
}

const depts = (u: UserRow) => (u.allDepartments ? "All departments" : u.departments.join(", ") || "None");

export function UsersList({ users, roles, departments }: { users: UserRow[]; roles: { id: number; name: string }[]; departments: { code: string; name: string }[] }) {
  return (
    <>
      <Filters roles={roles} departments={departments} />
      {!users.length ? (
        <p className="rounded-2xl border bg-card p-6 text-center text-muted-foreground">Nobody matches these filters.</p>
      ) : (
        <>
          {/* Phones: cards */}
          <ul className="flex flex-col gap-3 md:hidden">
            {users.map((u) => (
              <li key={u.id}>
                <Link href={`/settings/users/${u.id}`} className="block rounded-2xl border bg-card p-4 hover:border-primary/40">
                  <span className="flex items-start justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block font-semibold text-primary">{u.name}</span>
                      <span className="block truncate text-sm text-muted-foreground">{u.email ?? "No email"}</span>
                    </span>
                    <StatusChip status={u.status} />
                  </span>
                  <span className="mt-2 flex flex-wrap gap-1.5">
                    {u.roles.map((r) => (
                      <span key={r.id} className="rounded-full border bg-secondary px-2 py-0.5 text-xs font-medium">
                        {r.name}
                      </span>
                    ))}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">{depts(u)}</span>
                </Link>
              </li>
            ))}
          </ul>
          {/* Desktop: table */}
          <div className="hidden overflow-x-auto rounded-2xl border bg-card md:block">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-3 py-3 font-medium">Email</th>
                  <th className="px-3 py-3 font-medium">Mobile</th>
                  <th className="px-3 py-3 font-medium">Roles</th>
                  <th className="px-3 py-3 font-medium">Departments</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3 font-medium">Last sign-in</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {users.map((u) => (
                  <tr key={u.id} className={cn("hover:bg-secondary/40", u.status === "DEACTIVATED" && "text-muted-foreground")}>
                    <td className="px-4 py-3">
                      <Link href={`/settings/users/${u.id}`} className="font-semibold text-primary hover:underline">
                        {u.name}
                      </Link>
                      {u.isDemo ? <span className="ml-2 text-xs text-muted-foreground">(demo)</span> : null}
                    </td>
                    <td className="px-3 py-3">{u.email ?? "-"}</td>
                    <td className="px-3 py-3 tabular-nums">{u.mobile ?? "-"}</td>
                    <td className="px-3 py-3">
                      <span className="flex flex-wrap gap-1">
                        {u.roles.length ? (
                          u.roles.map((r) => (
                            <span key={r.id} className="rounded-full border bg-secondary px-2 py-0.5 text-xs font-medium whitespace-nowrap">
                              {r.name}
                            </span>
                          ))
                        ) : (
                          <span className="text-muted-foreground">None</span>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-3">{depts(u)}</td>
                    <td className="px-3 py-3">
                      <StatusChip status={u.status} />
                    </td>
                    <td className="px-3 py-3 text-muted-foreground tabular-nums">{u.lastSignInAt ? when.format(new Date(u.lastSignInAt)) : "Never"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
