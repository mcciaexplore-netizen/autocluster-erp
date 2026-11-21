"use client";

import { CalendarOff, Download, Loader2, Plus, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { FormSection } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addHolidayAction, deleteHolidayAction, importHolidaysAction } from "@/lib/actions/planning";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Settings > Planning > Holidays: machines that need an operator skip these days. */
export function HolidaysSection({ holidays, today }: { holidays: { id: number; date: string; name: string }[]; today: string }) {
  const router = useRouter();
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [showPast, setShowPast] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const upcoming = holidays.filter((h) => h.date >= today);
  const shown = showPast ? holidays : upcoming;

  return (
    <FormSection title="Holidays" description="Machines that need an operator don't work on these days. Machines that run day and night ignore them." icon={<CalendarOff className="size-5" />}>
      <form
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await addHolidayAction(date, name);
            if (!r.ok) return void toast.error(r.message);
            toast.success(`${name.trim()} added`);
            setDate("");
            setName("");
            router.refresh();
          });
        }}
      >
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Date
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-11 sm:w-44" required />
        </label>
        <label className="flex flex-1 flex-col gap-1.5 text-sm font-medium">
          Holiday
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Diwali (Lakshmi Puja)" maxLength={80} className="h-11" required />
        </label>
        <Button type="submit" disabled={pending} className="h-11">
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />} Add holiday
        </Button>
      </form>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          id="holidays-file"
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const form = new FormData();
            form.set("file", file);
            start(async () => {
              const r = await importHolidaysAction(form);
              if (fileRef.current) fileRef.current.value = "";
              if (!r.ok) return void toast.error(r.message);
              setProblems(r.data.problems);
              toast.success(`${r.data.added} ${r.data.added === 1 ? "holiday" : "holidays"} added${r.data.skipped ? `, ${r.data.skipped} already in the list` : ""}`);
              router.refresh();
            });
          }}
        />
        <Button asChild variant="outline" size="sm" disabled={pending}>
          <label htmlFor="holidays-file" className="cursor-pointer">
            <Upload aria-hidden /> Import from Excel
          </label>
        </Button>
        <Button asChild variant="ghost" size="sm">
          <a href="/api/planning/holidays-template" download>
            <Download aria-hidden /> Template
          </a>
        </Button>
        <span className="text-xs text-muted-foreground">Dates in column A, names in column B.</span>
      </div>
      {problems.length ? (
        <ul className="mt-3 list-disc rounded-xl border border-amber-300 bg-amber-50 py-2 pr-3 pl-8 text-sm text-amber-950">
          {problems.map((p) => (
            <li key={p}>{p} Not imported.</li>
          ))}
        </ul>
      ) : null}

      <ul className="mt-4 divide-y rounded-xl border">
        {shown.map((h) => (
          <li key={h.id} className={cn("flex items-center justify-between gap-3 px-3 py-1.5", h.date < today && "text-muted-foreground")}>
            <span>
              <span className="inline-block w-28 tabular-nums">{formatDate(h.date)}</span> {h.name}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove ${h.name}`}
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await deleteHolidayAction(h.id);
                  if (!r.ok) return void toast.error(r.message);
                  toast.success(`${h.name} removed`);
                  router.refresh();
                })
              }
            >
              <Trash2 aria-hidden />
            </Button>
          </li>
        ))}
        {!shown.length ? <li className="px-3 py-3 text-sm text-muted-foreground">No holidays coming up.</li> : null}
      </ul>
      {holidays.length > upcoming.length ? (
        <button type="button" className="mt-2 text-sm font-medium text-primary underline-offset-4 hover:underline" onClick={() => setShowPast((v) => !v)}>
          {showPast ? "Hide past holidays" : `Show past holidays (${holidays.length - upcoming.length})`}
        </button>
      ) : null}
    </FormSection>
  );
}
