/** The Excel template for "Import enquiries" (signed-in users only). */
import { routeAllow } from "@/lib/auth/guard";
import { getImportLists } from "@/lib/crm-data";
import { importTemplate } from "@/lib/crm/excel";

export async function GET() {
  const gate = await routeAllow("crm.import");
  if (gate.denied) return gate.denied;
  const bytes = await importTemplate(await getImportLists());
  return new Response(new Blob([bytes as BlobPart]), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="Enquiries-import-template.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
