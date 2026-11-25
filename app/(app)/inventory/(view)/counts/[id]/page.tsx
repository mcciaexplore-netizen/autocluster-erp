import type { Metadata } from "next";
import { ArrowLeft, Lock } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { FormSkeleton } from "@/components/common/form-skeleton";
import { CompleteCountButton, CountSheet } from "@/components/inventory/counts";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { getCount, getInvLists, type CountDetail } from "@/lib/inventory-data";
import { formatQty } from "@/lib/inventory/numbers";
import { UUID_RE } from "@/lib/inventory/uuid";
import { formatINR } from "@/lib/pricing";
import { cn } from "@/lib/utils";

/** Reads who is signed in (and stops with forbidden() when they may not see it), so it blocks on the server: no instant-navigation validation. */
export const instant = false;

export const metadata: Metadata = { title: "Stock count" };

type Sp = Promise<Record<string, string | string[] | undefined>>;

export default function CountPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Sp }) {
  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2">
        <Link href="/inventory/counts">
          <ArrowLeft aria-hidden /> Stock counts
        </Link>
      </Button>
      <Suspense fallback={<FormSkeleton />}>
        <Detail params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Detail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Sp }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const [c, lists, sp] = await Promise.all([getCount(id), getInvLists(), searchParams]);
  if (!c) notFound();
  const open = c.status === "IN_PROGRESS";
  const review = !open || sp.step === "review";
  return (
    <div className="flex flex-col gap-6">
      <header>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-title text-3xl text-primary tabular-nums md:text-4xl">{c.countNo}</h1>
          {open ? (
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-sm font-medium text-amber-900">Open</span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-sm font-medium text-emerald-900">
              <Lock className="size-3.5" aria-hidden /> Completed
            </span>
          )}
        </div>
        <p className="mt-2 text-muted-foreground">
          {c.label} · started {formatDate(c.startedAt)}
          {c.completedAt ? ` · completed ${formatDate(c.completedAt)}` : ""}
          {c.doneBy ? ` · by ${c.doneBy}` : ""}
        </p>
      </header>

      {open ? (
        <nav aria-label="Count steps" className="grid grid-cols-2 gap-2 sm:w-96">
          {[
            ["Count", `/inventory/counts/${c.id}`, !review],
            ["Review", `/inventory/counts/${c.id}?step=review`, review],
          ].map(([label, href, on]) => (
            <Link
              key={label as string}
              href={href as string}
              aria-current={on ? "step" : undefined}
              className={cn("flex min-h-11 items-center justify-center rounded-xl border text-sm font-medium", on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-secondary")}
            >
              {label}
            </Link>
          ))}
        </nav>
      ) : null}

      {review ? <Review c={c} team={lists.team.filter((t) => t.isActive)} /> : <CountSheet countId={c.id} lines={c.lines} />}
    </div>
  );
}

function Review({ c, team }: { c: CountDetail; team: { id: string; name: string }[] }) {
  const open = c.status === "IN_PROGRESS";
  const counted = c.lines.filter((l) => l.countedQty != null);
  const diffs = counted.filter((l) => l.diff != null && Number(l.diff) !== 0);
  const gain = diffs.reduce((a, l) => a + Math.max(l.valuePaise, 0), 0);
  const loss = diffs.reduce((a, l) => a + Math.max(-l.valuePaise, 0), 0);
  const notCounted = c.lines.length - counted.length;
  const net = gain - loss;
  return (
    <div className="flex flex-col gap-5">
      {!open && c.adjustment ? (
        <p className="rounded-xl border bg-secondary p-3 text-sm">
          Stock was corrected by{" "}
          <Link href={`/inventory/movements/${c.adjustment.id}`} className="font-medium text-primary hover:underline">
            {c.adjustment.docNo}
          </Link>
          . This count is locked.
        </p>
      ) : null}
      {open ? <p className="text-sm text-muted-foreground">Counted quantities are compared with the stock now: the stock at the start plus or minus anything that moved since.</p> : null}

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Counted", `${counted.length} of ${c.lines.length}`],
          ["Differences", String(diffs.length)],
          ["Gain", formatINR(gain)],
          ["Loss", formatINR(loss)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-2xl border bg-card p-4">
            <dt className="text-sm text-muted-foreground">{k}</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>

      {diffs.length ? (
        <div className="overflow-x-auto rounded-2xl border bg-card">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b bg-secondary/60 text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Item</th>
                <th className="px-4 py-3 text-right font-medium">Expected</th>
                <th className="px-4 py-3 text-right font-medium">Counted</th>
                <th className="px-4 py-3 text-right font-medium">Difference</th>
                <th className="px-4 py-3 text-right font-medium">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {diffs.map((l) => {
                const d = Number(l.diff);
                return (
                  <tr key={l.id}>
                    <td className="px-4 py-3">
                      <Link href={`/inventory/items/${l.itemId}`} className="font-medium hover:text-primary hover:underline">
                        {l.name}
                      </Link>
                      <span className="block text-xs text-muted-foreground">
                        {[l.code, l.batchNo ? `batch ${l.batchNo}` : null, Number(l.movedQty) !== 0 ? `${formatQty(l.systemQty, l.unit)} at start` : null].filter(Boolean).join(" · ")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatQty(l.expectedQty, l.unit)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatQty(l.countedQty, l.unit)}</td>
                    <td className={cn("px-4 py-3 text-right font-semibold tabular-nums", d < 0 ? "text-destructive" : "text-emerald-700")}>
                      {d > 0 ? "+" : "−"}
                      {formatQty(Math.abs(d), l.unit)}
                    </td>
                    <td className={cn("px-4 py-3 text-right tabular-nums", l.valuePaise < 0 ? "text-destructive" : "text-emerald-700")}>
                      {l.valuePaise > 0 ? "+" : l.valuePaise < 0 ? "−" : ""}
                      {formatINR(Math.abs(l.valuePaise))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t bg-secondary/40">
              <tr>
                <td colSpan={4} className="px-4 py-3 text-right font-medium">
                  Total {net < 0 ? "loss" : "gain"}
                </td>
                <td className={cn("px-4 py-3 text-right font-semibold tabular-nums", net < 0 ? "text-destructive" : "text-emerald-700")}>
                  {net > 0 ? "+" : net < 0 ? "−" : ""}
                  {formatINR(Math.abs(net))}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <p className="rounded-2xl border bg-card p-6 text-center text-muted-foreground">
          {counted.length ? "Everything counted matches the stock." : "Nothing has been counted yet."}
        </p>
      )}

      {open ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            {notCounted ? `${notCounted} ${notCounted === 1 ? "line isn't" : "lines aren't"} counted and will be left as ${notCounted === 1 ? "it is" : "they are"}.` : "Every line is counted."}
          </p>
          {counted.length ? (
            <CompleteCountButton
              countId={c.id}
              countNo={c.countNo}
              changes={diffs.length}
              notCounted={c.lines.filter((l) => l.countedQty == null).map((l) => ({ id: l.id, name: l.name, code: l.code, batchNo: l.batchNo }))}
              team={team}
            />
          ) : (
            <Button asChild size="lg">
              <Link href={`/inventory/counts/${c.id}`}>Start counting</Link>
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}
