/** The Excel template for importing holidays (signed-in users only). */
import { routeAllow } from "@/lib/auth/guard";
import { holidaysTemplate } from "@/lib/planning/holiday-excel";

export async function GET() {
  const gate = await routeAllow("planning.machines");
  if (gate.denied) return gate.denied;
  return new Response(new Blob([(await holidaysTemplate()) as BlobPart]), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="Holidays-template.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
