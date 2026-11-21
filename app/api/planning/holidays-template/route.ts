/** The Excel template for importing holidays (signed-in users only). */
import { isSignedIn } from "@/lib/auth-guard";
import { holidaysTemplate } from "@/lib/planning/holiday-excel";

export async function GET() {
  if (!(await isSignedIn())) return Response.json({ error: "Please sign in again." }, { status: 401 });
  return new Response(new Blob([(await holidaysTemplate()) as BlobPart]), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="Holidays-template.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
