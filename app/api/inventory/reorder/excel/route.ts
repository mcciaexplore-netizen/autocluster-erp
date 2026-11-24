/** Order list as Excel (Reorder list > Send to supplier > Excel). */
import { routeAllow } from "@/lib/auth/guard";
import { getOrderListData } from "@/lib/inventory-data";
import { orderListWorkbook } from "@/lib/inventory/excel";
import { parseOrderListQuery } from "@/lib/inventory/order-params";

export async function GET(request: Request) {
  const gate = await routeAllow("inventory.view");
  if (gate.denied) return gate.denied;
  const q = parseOrderListQuery(new URL(request.url).searchParams);
  if (!q) return Response.json({ error: "This order list link doesn't look right." }, { status: 400 });
  const data = await getOrderListData(q.supplierId, q.lines);
  const bytes = await orderListWorkbook(data);
  const name = `Order-list-${(data.supplier?.name ?? "supplier").replace(/[^A-Za-z0-9]+/g, "-")}-${data.today}.xlsx`;
  return new Response(new Blob([bytes as BlobPart]), {
    headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" },
  });
}
