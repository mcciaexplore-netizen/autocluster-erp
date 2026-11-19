/** Downloads the billing details (Excel) for the ticked services. Signed-in users only. */
import { z } from "zod";
import { db } from "@/db";
import { UserFacingError } from "@/db/quote-writer";
import { isSignedIn } from "@/lib/auth-guard";
import { exportBilling } from "@/lib/tally";
import { todayInIndia } from "@/lib/tickets";

const body = z.object({ ticketIds: z.array(z.string().uuid()).min(1).max(100) });

export async function POST(request: Request) {
  if (!(await isSignedIn())) return Response.json({ error: "Please sign in again." }, { status: 401 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Please tick at least one service." }, { status: 400 });
  try {
    const result = await exportBilling(db, parsed.data.ticketIds, todayInIndia());
    if (result.kind !== "file") return Response.json({ ok: true, reference: result.reference });
    return new Response(new Blob([result.bytes as BlobPart], { type: result.mime }), {
      headers: {
        "Content-Type": result.mime,
        "Content-Disposition": `attachment; filename="${result.fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof UserFacingError) return Response.json({ error: e.message }, { status: 409 });
    console.error("billing export", e);
    return Response.json({ error: "We couldn't prepare the file. Please try again." }, { status: 500 });
  }
}
