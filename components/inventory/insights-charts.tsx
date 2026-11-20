"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatINRShort } from "@/lib/pricing";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`;
const axis = { fontSize: 12, fill: "var(--muted-foreground)" };
/** Rupees on an axis: ₹12k, ₹1.2L. */
const shortRupees = (paise: number) => {
  const r = paise / 100;
  if (r >= 1_00_000) return `₹${(r / 1_00_000).toLocaleString("en-IN", { maximumFractionDigits: 1 })}L`;
  if (r >= 1000) return `₹${(r / 1000).toLocaleString("en-IN", { maximumFractionDigits: 0 })}k`;
  return `₹${r.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
};

/**
 * Fixed colour per series (validated categorical palette: CVD-safe neighbours). The colour
 * follows the department, never its position, so filtering never repaints a series.
 */
export const SERIES_COLOURS: Record<string, string> = { RPT: "#2a78d6", PPF: "#eb6834", ENV: "#1baf7a", RPL: "#eda100", OTHER: "#e87ba4", INTERNAL: "#6250d6" };
const colour = (key: string) => SERIES_COLOURS[key] ?? "#6B7280";

function TipBox({ title, lines, total }: { title: string; lines: { label: string; value: string; colour?: string }[]; total?: string }) {
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
      {total ? (
        <p className="mt-1 flex justify-between gap-4 border-t pt-1 font-medium">
          <span>Total</span>
          <span className="tabular-nums">{total}</span>
        </p>
      ) : null}
    </div>
  );
}

function Legend({ series }: { series: { key: string; name: string }[] }) {
  return (
    <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground" aria-label="Legend">
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span className="size-3 rounded-sm" style={{ background: colour(s.key) }} aria-hidden />
          {s.name}
        </li>
      ))}
    </ul>
  );
}

/** Value of stock used per month, stacked by department (internal use separately). */
export function SpendChart({ rows, series }: { rows: ({ month: string } & Record<string, number>)[]; series: { key: string; name: string }[] }) {
  if (!series.length) return <p className="text-sm text-muted-foreground">No stock was used in this period.</p>;
  const last = series.at(-1)!.key;
  return (
    <figure>
      {series.length > 1 ? <Legend series={series} /> : null}
      <div className="h-64 w-full" role="img" aria-label="Value of stock used per month, by department">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="month" tickFormatter={monthLabel} tick={axis} tickLine={false} axisLine={{ stroke: "var(--border)" }} interval="preserveStartEnd" minTickGap={8} />
            <YAxis tick={axis} tickLine={false} axisLine={false} width={52} tickFormatter={shortRupees} />
            <Tooltip
              cursor={{ fill: "var(--secondary)" }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0].payload as Record<string, number>;
                const lines = series.filter((s) => row[s.key] > 0).map((s) => ({ label: s.name, value: formatINRShort(row[s.key]), colour: colour(s.key) }));
                const total = series.reduce((a, s) => a + (row[s.key] ?? 0), 0);
                return <TipBox title={monthLabel(String(label))} lines={lines.length ? lines : [{ label: "Nothing used", value: "" }]} total={lines.length > 1 ? formatINRShort(total) : undefined} />;
              }}
            />
            {series.map((s) => (
              // A 2px gap in the card colour between stacked segments; only the top segment is rounded.
              <Bar key={s.key} dataKey={s.key} stackId="spend" fill={colour(s.key)} stroke="var(--card)" strokeWidth={1} radius={s.key === last ? [4, 4, 0, 0] : 0} maxBarSize={40} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="sr-only">
        {rows.map((r) => `${monthLabel(r.month)}: ${series.map((s) => `${s.name} ${formatINRShort(r[s.key] ?? 0)}`).join(", ")}`).join("; ")}
      </figcaption>
    </figure>
  );
}

/** One value per month (single series, so no legend). */
export function MonthBars({ rows, label }: { rows: { month: string; value: number }[]; label: string }) {
  if (!rows.some((r) => r.value > 0)) return null;
  return (
    <figure>
      <div className="h-48 w-full" role="img" aria-label={label}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="month" tickFormatter={monthLabel} tick={axis} tickLine={false} axisLine={{ stroke: "var(--border)" }} interval="preserveStartEnd" minTickGap={8} />
            <YAxis tick={axis} tickLine={false} axisLine={false} width={52} tickFormatter={shortRupees} />
            <Tooltip
              cursor={{ fill: "var(--secondary)" }}
              content={({ active, payload, label: l }) => (active && payload?.length ? <TipBox title={monthLabel(String(l))} lines={[{ label: "Written off", value: formatINRShort(Number(payload[0].value)) }]} /> : null)}
            />
            <Bar dataKey="value" fill="#e34948" radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="sr-only">{rows.map((r) => `${monthLabel(r.month)}: ${formatINRShort(r.value)}`).join("; ")}</figcaption>
    </figure>
  );
}

/** Horizontal bars, largest first, with the value written at the end of each bar. */
export function ValueBars({ rows, label }: { rows: { name: string; valuePaise: number }[]; label: string }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">Nothing in stock.</p>;
  const max = Math.max(...rows.map((r) => r.valuePaise), 1);
  return (
    <ul className="flex flex-col gap-2" aria-label={label}>
      {rows.map((r) => (
        <li key={r.name} className="grid grid-cols-[minmax(0,9rem)_1fr] items-center gap-3 text-sm sm:grid-cols-[minmax(0,12rem)_1fr]">
          <span className="truncate text-muted-foreground" title={r.name}>
            {r.name}
          </span>
          <span className="flex min-w-0 items-center gap-2">
            <span className="h-3.5 rounded-r-[4px] bg-primary" style={{ width: `${Math.max(2, (r.valuePaise / max) * 75)}%` }} aria-hidden />
            <span className="shrink-0 font-medium tabular-nums">{formatINRShort(r.valuePaise)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
