import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { formatDate } from "@/lib/format";
import type { NeedsAttention } from "@/lib/planning-data";
import { formatWhen } from "@/lib/planning/hours";
import { BLOCK_TYPES } from "@/lib/validation/planning";
import { ClashActions } from "./clash-actions";
import { StillBrokenDown } from "./still-broken";

function Box({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card">
      <h3 className="flex items-center justify-between gap-2 border-b px-3 py-2 text-sm font-semibold">
        {title} <span className="rounded-full bg-secondary px-2 text-xs tabular-nums">{count}</span>
      </h3>
      <ul className="divide-y text-sm">{children}</ul>
    </div>
  );
}

const JobLink = ({ jobId, children }: { jobId: string; children: React.ReactNode }) => (
  <Link href={`?job=${jobId}`} scroll={false} className="block px-3 py-2 hover:bg-secondary/60">
    {children}
  </Link>
);

/** Top of the Timeline: everything someone should act on now. Hidden when there's nothing. */
export function NeedsAttentionPanel({ n }: { n: NeedsAttention }) {
  const total = n.late.length + n.expiredHolds.length + n.overruns.length + n.unplannedLate.length + n.clashes.length + n.broken.length;
  if (!total) return null;
  return (
    <section aria-labelledby="na-h" className="rounded-2xl border border-amber-300 bg-amber-50/60 p-3 sm:p-4">
      <h2 id="na-h" className="mb-3 flex items-center gap-2 font-semibold">
        <AlertTriangle className="size-5 text-amber-600" aria-hidden /> Needs attention
      </h2>
      {n.broken.length ? (
        <div className="mb-3 flex flex-col gap-2">
          {n.broken.map((m) => (
            <StillBrokenDown key={m.id} machineId={m.id} machineName={m.name} expectedEnd={m.expectedEnd.toISOString()} />
          ))}
        </div>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {n.overruns.length ? (
          <Box title="Still running?" count={n.overruns.length}>
            {n.overruns.map((r) => (
              <li key={r.jobId}>
                <JobLink jobId={r.jobId}>
                  <span className="font-medium tabular-nums">{r.ticketNo}</span> {r.company}
                  <span className="block text-xs text-red-800">
                    Started {formatWhen(r.startedAt)}, booked to end {formatWhen(r.bookedEnd)}
                    {r.machine ? ` · ${r.machine}` : ""}
                  </span>
                </JobLink>
              </li>
            ))}
          </Box>
        ) : null}
        {n.late.length ? (
          <Box title="Late jobs" count={n.late.length}>
            {n.late.slice(0, 8).map((j) => (
              <li key={j.id}>
                <JobLink jobId={j.id}>
                  <span className="font-medium tabular-nums">{j.ticketNo}</span> {j.company}
                  <span className="block text-xs text-red-800">
                    Promised {j.promisedDate ? formatDate(j.promisedDate) : "-"}
                    {j.plannedEnd ? `, planned to end ${formatWhen(j.plannedEnd)}` : ""}
                  </span>
                </JobLink>
              </li>
            ))}
          </Box>
        ) : null}
        {n.unplannedLate.length ? (
          <Box title="Past the promised date, not planned" count={n.unplannedLate.length}>
            {n.unplannedLate.map((j) => (
              <li key={j.id}>
                <JobLink jobId={j.id}>
                  <span className="font-medium tabular-nums">{j.ticket_no}</span> {j.company}
                  <span className="block text-xs text-red-800">Promised {formatDate(j.promised_date)}</span>
                </JobLink>
              </li>
            ))}
          </Box>
        ) : null}
        {n.expiredHolds.length ? (
          <Box title="Tentative holds expired" count={n.expiredHolds.length}>
            {n.expiredHolds.map((h) => (
              <li key={h.bookingId}>
                <JobLink jobId={h.jobId}>
                  <span className="font-medium tabular-nums">{h.ticketNo}</span> {h.company}
                  <span className="block text-xs text-red-800">
                    {h.machine}, {formatWhen(h.start)} · held until {formatDate(h.holdUntil)}: extend or release it
                  </span>
                </JobLink>
              </li>
            ))}
          </Box>
        ) : null}
      </div>
      {n.clashes.length ? (
        <div className="mt-3 rounded-xl border bg-card">
          <h3 className="flex items-center justify-between border-b px-3 py-2 text-sm font-semibold">
            Bookings that clash with a breakdown or blocked time <span className="rounded-full bg-secondary px-2 text-xs tabular-nums">{n.clashes.length}</span>
          </h3>
          <ul className="divide-y text-sm">
            {n.clashes.map((c) => (
              <li key={c.bookingId} className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                <span>
                  <span className="font-medium tabular-nums">{c.ticketNo}</span> {c.company}
                  <span className="block text-xs">
                    {c.machine}, {formatWhen(c.startAt)} to {formatWhen(c.endAt)} · {BLOCK_TYPES[c.blockType].toLowerCase()}
                  </span>
                </span>
                <ClashActions bookingId={c.bookingId} jobId={c.jobId} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
