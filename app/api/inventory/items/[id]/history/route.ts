/** "Download as Excel" on an item's stock history. */
import { routeAllow } from "@/lib/auth/guard";
import { getInvItem, getItemHistory } from "@/lib/inventory-data";
import { itemHistoryWorkbook } from "@/lib/inventory/excel";
import { UUID_RE } from "@/lib/inventory/uuid";

export async function GET(_req: Request, ctx: RouteContext<"/api/inventory/items/[id]/history">) {
  const gate = await routeAllow("inventory.view");
  if (gate.denied) return gate.denied;
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return Response.json({ error: "Not found." }, { status: 404 });
  const d = await getInvItem(id);
  if (!d) return Response.json({ error: "Not found." }, { status: 404 });
  const bytes = await itemHistoryWorkbook({ name: d.item.name, code: d.item.code, unit: d.item.unit }, await getItemHistory(id, 100000));
  return new Response(new Blob([bytes as BlobPart]), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Stock-history-${d.item.code}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
