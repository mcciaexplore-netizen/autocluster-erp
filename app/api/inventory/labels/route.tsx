/** "Print label": an A4 sheet of labels with a QR code that opens the item page. ?item=&batch=&count=&outline=1 */
import { renderToBuffer } from "@react-pdf/renderer";
import QRCode from "qrcode";
import { routeAllow } from "@/lib/auth/guard";
import { getInvItem } from "@/lib/inventory-data";
import { UUID_RE } from "@/lib/inventory/uuid";
import { LABELS_PER_SHEET, LabelsPdf } from "@/lib/pdf/labels-pdf";

export async function GET(request: Request) {
  const gate = await routeAllow("inventory.view");
  if (gate.denied) return gate.denied;
  const url = new URL(request.url);
  const itemId = url.searchParams.get("item") ?? "";
  const batchId = url.searchParams.get("batch");
  if (!UUID_RE.test(itemId) || (batchId && !UUID_RE.test(batchId))) return new Response("This label link doesn't look right.", { status: 400 });
  const count = Math.min(LABELS_PER_SHEET, Math.max(1, Math.floor(Number(url.searchParams.get("count")) || LABELS_PER_SHEET)));
  const d = await getInvItem(itemId);
  if (!d) return new Response("This item could not be found.", { status: 404 });
  const batch = batchId ? d.batches.find((b) => b.id === batchId) : null;
  if (batchId && !batch) return new Response("This batch could not be found.", { status: 404 });
  // The QR opens the item page on this same site (after sign-in), with "Use stock" at the top.
  const qrDataUrl = await QRCode.toDataURL(`${url.origin}/inventory/items/${itemId}`, { margin: 1, width: 360, errorCorrectionLevel: "M" });
  const rendered = await renderToBuffer(
    <LabelsPdf
      count={count}
      label={{ name: d.item.name, code: d.item.code, unit: d.item.unit, batchNo: batch?.batchNo, expiryDate: batch?.expiryDate, qrDataUrl, outline: url.searchParams.get("outline") === "1" }}
    />,
  );
  const name = `Labels-${d.item.code}${batch ? `-${batch.batchNo.replace(/[^A-Za-z0-9]+/g, "-")}` : ""}.pdf`;
  return new Response(new Blob([new Uint8Array(rendered) as BlobPart], { type: "application/pdf" }), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${name}"`, "Cache-Control": "no-store" },
  });
}
