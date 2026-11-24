/** Order list as a PDF (Reorder list > Send to supplier > PDF). */
import { renderToBuffer } from "@react-pdf/renderer";
import { routeAllow } from "@/lib/auth/guard";
import { formatDate } from "@/lib/format";
import { getOrderListData } from "@/lib/inventory-data";
import { parseOrderListQuery } from "@/lib/inventory/order-params";
import { OrderListPdf } from "@/lib/pdf/order-pdf";
import { stampPageNumbers } from "@/lib/pdf/page-numbers";

export async function GET(request: Request) {
  const gate = await routeAllow("inventory.view");
  if (gate.denied) return gate.denied;
  const q = parseOrderListQuery(new URL(request.url).searchParams);
  if (!q) return new Response("This order list link doesn't look right.", { status: 400 });
  const data = await getOrderListData(q.supplierId, q.lines);
  const rendered = await renderToBuffer(<OrderListPdf data={data} />);
  const pdf = await stampPageNumbers(new Uint8Array(rendered), `Order list ${formatDate(data.today)}`);
  const name = `Order-list-${(data.supplier?.name ?? "supplier").replace(/[^A-Za-z0-9]+/g, "-")}-${data.today}.pdf`;
  return new Response(new Blob([pdf as BlobPart], { type: "application/pdf" }), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" },
  });
}
