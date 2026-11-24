/** The Excel template for "Import items" (signed-in users only). */
import { routeAllow } from "@/lib/auth/guard";
import { getItemImportLists } from "@/lib/inventory-data";
import { itemImportTemplate } from "@/lib/inventory/excel";

export async function GET() {
  const gate = await routeAllow("inventory.items");
  if (gate.denied) return gate.denied;
  const bytes = await itemImportTemplate(await getItemImportLists());
  return new Response(new Blob([bytes as BlobPart]), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="Items-import-template.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
