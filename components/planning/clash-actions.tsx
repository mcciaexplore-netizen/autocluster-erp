"use client";

import { Loader2, MoveRight, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { moveToNextFreeSlotAction } from "@/lib/actions/jobs";
import { formatWhen } from "@/lib/planning/hours";

/** For a booking that clashes with blocked time: "Move to next free slot" or "Pick another machine". */
export function ClashActions({ bookingId, jobId }: { bookingId: string; jobId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await moveToNextFreeSlotAction(bookingId);
            if (!r.ok) return void toast.error(r.message);
            toast.success(`Moved to ${r.data.machine}: ${formatWhen(new Date(r.data.start))} to ${formatWhen(new Date(r.data.end))}`);
            router.refresh();
          })
        }
      >
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />} Move to next free slot
      </Button>
      <Button asChild size="sm" variant="outline" className="bg-white">
        <Link href={`?job=${jobId}&move=${bookingId}&another=1`} scroll={false}>
          <MoveRight aria-hidden /> Pick another machine
        </Link>
      </Button>
    </div>
  );
}
