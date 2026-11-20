"use client";

import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatDate } from "@/lib/format";
import { formatQty } from "@/lib/inventory/numbers";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`;
const axis = { fontSize: 12, fill: "var(--muted-foreground)" };

function TipBox({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-sm shadow-md">
      <p className="font-medium">{title}</p>
      {lines.map((l) => (
        <p key={l} className="text-muted-foreground">
          {l}
        </p>
      ))}
    </div>
  );
}

/** Quantity used per month for the last 12 months (one series, so no legend). */
export function UsageChart({ data, unit }: { data: { month: string; used: number }[]; unit: string }) {
  if (!data.some((d) => d.used > 0)) return <p className="text-sm text-muted-foreground">No use recorded in the last 12 months.</p>;
  return (
    <figure>
      <div className="h-56 w-full" role="img" aria-label={`Quantity used per month, last 12 months, in ${unit}`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="month" tickFormatter={monthLabel} tick={axis} tickLine={false} axisLine={{ stroke: "var(--border)" }} interval="preserveStartEnd" minTickGap={8} />
            <YAxis tick={axis} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => formatQty(v)} />
            <Tooltip
              cursor={{ fill: "var(--secondary)" }}
              content={({ active, payload }) =>
                active && payload?.length ? <TipBox title={monthLabel(String(payload[0].payload.month))} lines={[`Used ${formatQty(Number(payload[0].value), unit)}`]} /> : null
              }
            />
            <Bar dataKey="used" fill="var(--primary)" radius={[4, 4, 0, 0]} maxBarSize={36} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="sr-only">
        {data.map((d) => `${monthLabel(d.month)}: ${formatQty(d.used, unit)}`).join("; ")}
      </figcaption>
    </figure>
  );
}

/** Purchase rate (before GST) per unit over time; each point is one delivery. */
export function PriceChart({ data, unit }: { data: { date: string; rate: number; supplier: string; docNo: string }[]; unit: string }) {
  if (data.length < 2) return null;
  return (
    <figure>
      <div className="h-52 w-full" role="img" aria-label={`Purchase rate per ${unit} over time`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="date" tickFormatter={(d: string) => formatDate(d).replace(/^\d+ /, "")} tick={axis} tickLine={false} axisLine={{ stroke: "var(--border)" }} minTickGap={24} />
            <YAxis tick={axis} tickLine={false} axisLine={false} width={56} domain={["auto", "auto"]} tickFormatter={(v: number) => `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`} />
            <Tooltip
              cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as (typeof data)[number];
                return <TipBox title={formatDate(p.date)} lines={[`₹${p.rate.toLocaleString("en-IN", { maximumFractionDigits: 4 })} per ${unit}`, p.supplier, p.docNo]} />;
              }}
            />
            <Line type="monotone" dataKey="rate" stroke="var(--primary)" strokeWidth={2} dot={{ r: 4, fill: "var(--primary)", stroke: "var(--card)", strokeWidth: 2 }} activeDot={{ r: 6 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="sr-only">{data.map((d) => `${formatDate(d.date)}: ₹${d.rate} (${d.supplier})`).join("; ")}</figcaption>
    </figure>
  );
}
