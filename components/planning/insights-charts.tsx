"use client";

import Link from "next/link";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`;
const axis = { fontSize: 12, fill: "var(--muted-foreground)" };
const hrs = (h: number) => `${(Math.round(h * 10) / 10).toLocaleString("en-IN")} h`;
const pct = (v: number | null) => (v == null ? "-" : `${Math.round(v)}%`);

/** Validated categorical slots, in fixed order. */
const BOOKED = "#2a78d6";
const ACTUAL = "#eb6834";
/** Block types keep their colour whatever the filter shows. */
const BLOCK_COLOURS: Record<string, string> = {
  MAINTENANCE: "#2a78d6",
  CALIBRATION: "#eb6834",
  BREAKDOWN: "#1baf7a",
  INTERNAL: "#eda100",
  OTHER: "#e87ba4",
};

function Legend({ items }: { items: { name: string; colour: string }[] }) {
  return (
    <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground" aria-label="Legend">
      {items.map((s) => (
        <li key={s.name} className="flex items-center gap-1.5">
          <span className="size-3 rounded-sm" style={{ background: s.colour }} aria-hidden />
          {s.name}
        </li>
      ))}
    </ul>
  );
}

function TipBox({ title, lines }: { title: string; lines: { label: string; value: string; colour?: string }[] }) {
  return (
    <div className="min-w-44 rounded-lg border bg-popover px-3 py-2 text-sm shadow-md">
      <p className="mb-1 font-medium">{title}</p>
      {lines.map((l) => (
        <p key={l.label} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            {l.colour ? <span className="size-2.5 rounded-sm" style={{ background: l.colour }} aria-hidden /> : null}
            {l.label}
          </span>
          <span className="tabular-nums">{l.value}</span>
        </p>
      ))}
    </div>
  );
}

type UseRow = {
  id: string;
  name: string;
  deptCode: string | null;
  availableHours: number;
  bookedHours: number;
  actualHours: number;
  bookedPct: number | null;
  actualPct: number | null;
};

/** Booked % and actual % per machine, busiest first: two thin bars on a 0-100% scale. */
export function UseBars({ rows }: { rows: UseRow[] }) {
  const [all, setAll] = useState(false);
  if (!rows.length) return <p className="text-sm text-muted-foreground">No machines in this department.</p>;
  const shown = all ? rows : rows.slice(0, 12);
  const w = (v: number | null) => `${Math.min(100, Math.max(v ?? 0, 0))}%`;
  return (
    <figure>
      <Legend
        items={[
          { name: "Booked", colour: BOOKED },
          { name: "Actually running", colour: ACTUAL },
        ]}
      />
      <ul className="flex flex-col gap-2.5">
        {shown.map((m) => (
          <li
            key={m.id}
            className="group grid grid-cols-[minmax(0,8.5rem)_1fr_4.5rem] items-center gap-3 rounded-md px-1 py-0.5 text-sm hover:bg-secondary sm:grid-cols-[minmax(0,15rem)_1fr_6rem]"
            title={`${m.name}: booked ${pct(m.bookedPct)} (${hrs(m.bookedHours)} of ${hrs(m.availableHours)} available), actually running ${pct(m.actualPct)} (${hrs(m.actualHours)})`}
          >
            <Link href={`/planning/machines/${m.id}`} className="truncate text-muted-foreground hover:text-primary hover:underline">
              {m.name}
            </Link>
            <span className="relative flex flex-col gap-0.5" aria-hidden>
              <span
                className="h-2.5 rounded-r-[4px]"
                style={{
                  width: w(m.bookedPct),
                  background: BOOKED,
                  minWidth: m.bookedPct ? 2 : 0,
                }}
              />
              <span
                className="h-2.5 rounded-r-[4px]"
                style={{
                  width: w(m.actualPct),
                  background: ACTUAL,
                  minWidth: m.actualPct ? 2 : 0,
                }}
              />
            </span>
            <span className="text-right text-xs tabular-nums">
              <span className="block font-medium">{m.availableHours > 0 ? pct(m.bookedPct) : "Not available"}</span>
              <span className="block text-muted-foreground">{m.availableHours > 0 ? pct(m.actualPct) : ""}</span>
            </span>
          </li>
        ))}
      </ul>
      {rows.length > 12 ? (
        <button type="button" onClick={() => setAll(!all)} className="mt-3 min-h-9 text-sm font-medium text-primary underline-offset-4 hover:underline">
          {all ? "Show the 12 busiest" : `Show all ${rows.length} machines`}
        </button>
      ) : null}
      <figcaption className="sr-only">{rows.map((m) => `${m.name}: booked ${pct(m.bookedPct)}, running ${pct(m.actualPct)}`).join("; ")}</figcaption>
    </figure>
  );
}

/** Horizontal bars with a label at the end (one series, so no legend). */
export function LabelBars({
  rows,
  label,
}: {
  rows: {
    key: string;
    name: string;
    value: number;
    text: string;
    sub?: string;
    href?: string;
  }[];
  label: string;
}) {
  if (!rows.length) return null;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="flex flex-col gap-2" aria-label={label}>
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-1 items-center gap-x-3 gap-y-1 text-sm sm:grid-cols-[minmax(0,15rem)_1fr]">
          {r.href ? (
            <Link href={r.href} className="truncate text-muted-foreground hover:text-primary hover:underline" title={r.name}>
              {r.name}
            </Link>
          ) : (
            <span className="truncate text-muted-foreground" title={r.name}>
              {r.name}
            </span>
          )}
          <span className="flex min-w-0 items-center gap-2">
            <span
              className="h-3.5 shrink-0 rounded-r-[4px] bg-primary"
              style={{
                width: `${Math.max(r.value > 0 ? 1 : 0, (r.value / max) * 45)}%`,
              }}
              aria-hidden
            />
            <span className="min-w-0 flex-1 text-sm">
              <span className="font-medium tabular-nums">{r.text}</span>
              {r.sub ? <span className="block text-xs text-muted-foreground sm:ml-2 sm:inline">{r.sub}</span> : null}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** On-time % per month (all departments together). */
export function OnTimeChart({ rows }: { rows: { month: string; done: number; onTime: number; pct: number | null }[] }) {
  if (!rows.some((r) => r.done > 0)) return null;
  return (
    <figure>
      <div className="h-48 w-full" role="img" aria-label="Jobs done on time, % per month">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows.map((r) => ({ ...r, value: r.pct ?? 0 }))} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="month" tickFormatter={monthLabel} tick={axis} tickLine={false} axisLine={{ stroke: "var(--border)" }} interval="preserveStartEnd" minTickGap={8} />
            <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={axis} tickLine={false} axisLine={false} width={40} tickFormatter={(v) => `${v}%`} />
            <Tooltip
              cursor={{ fill: "var(--secondary)" }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const r = payload[0].payload as {
                  done: number;
                  onTime: number;
                  pct: number | null;
                };
                return (
                  <TipBox
                    title={monthLabel(String(label))}
                    lines={
                      r.done
                        ? [
                            { label: "On time", value: pct(r.pct) },
                            { label: "Jobs done", value: String(r.done) },
                            { label: "Late", value: String(r.done - r.onTime) },
                          ]
                        : [{ label: "No jobs done", value: "" }]
                    }
                  />
                );
              }}
            />
            <Bar dataKey="value" fill={BOOKED} radius={[4, 4, 0, 0]} maxBarSize={40} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="sr-only">{rows.map((r) => `${monthLabel(r.month)}: ${r.done ? `${pct(r.pct)} on time of ${r.done}` : "no jobs done"}`).join("; ")}</figcaption>
    </figure>
  );
}

/** Hours blocked per month, stacked by type. */
export function BlockedChart({ rows, types }: { rows: ({ month: string } & Record<string, number | string>)[]; types: { key: string; name: string }[] }) {
  if (!types.length) return null;
  const last = types.at(-1)!.key;
  return (
    <figure>
      {types.length > 1 ? (
        <Legend
          items={types.map((t) => ({
            name: t.name,
            colour: BLOCK_COLOURS[t.key],
          }))}
        />
      ) : null}
      <div className="h-56 w-full" role="img" aria-label="Machine hours not available per month, by reason">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="month" tickFormatter={monthLabel} tick={axis} tickLine={false} axisLine={{ stroke: "var(--border)" }} interval="preserveStartEnd" minTickGap={8} />
            <YAxis tick={axis} tickLine={false} axisLine={false} width={44} tickFormatter={(v) => `${v} h`} />
            <Tooltip
              cursor={{ fill: "var(--secondary)" }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const r = payload[0].payload as Record<string, number>;
                const lines = types
                  .filter((t) => r[t.key] > 0)
                  .map((t) => ({
                    label: t.name,
                    value: hrs(r[t.key]),
                    colour: BLOCK_COLOURS[t.key],
                  }));
                return <TipBox title={monthLabel(String(label))} lines={lines.length ? lines : [{ label: "Nothing blocked", value: "" }]} />;
              }}
            />
            {types.map((t) => (
              <Bar
                key={t.key}
                dataKey={t.key}
                stackId="blocked"
                fill={BLOCK_COLOURS[t.key]}
                stroke="var(--card)"
                strokeWidth={1}
                radius={t.key === last ? [4, 4, 0, 0] : 0}
                maxBarSize={40}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="sr-only">{rows.map((r) => `${monthLabel(r.month)}: ${types.map((t) => `${t.name} ${hrs(Number(r[t.key]))}`).join(", ")}`).join("; ")}</figcaption>
    </figure>
  );
}
