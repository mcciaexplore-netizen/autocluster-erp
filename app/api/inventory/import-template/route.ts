/** The Excel template for "Import items" (signed-in users only). */
import { isSignedIn } from "@/lib/auth-guard";
import { getItemImportLists } from "@/lib/inventory-data";
import { itemImportTemplate } from "@/lib/inventory/excel";

export async function GET() {
  if (!(await isSignedIn())) return Response.json({ error: "Please sign in again." }, { status: 401 });
  const bytes = await itemImportTemplate(await getItemImportLists());
  return new Response(new Blob([bytes as BlobPart]), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="Items-import-template.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
