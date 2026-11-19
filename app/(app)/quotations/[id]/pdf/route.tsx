import { renderToBuffer } from "@react-pdf/renderer";
import { isSignedIn } from "@/lib/auth-guard";
import { getQuotation, getSettings } from "@/lib/data";
import { stampPageNumbers } from "@/lib/pdf/page-numbers";
import { QuotationPdf } from "@/lib/pdf/quotation-pdf";
import { viewFromSaved } from "@/lib/quote-view";

export async function GET(request: Request, ctx: RouteContext<"/quotations/[id]/pdf">) {
  if (!(await isSignedIn())) return new Response("Please sign in first.", { status: 401 });
  const { id } = await ctx.params;
  const [q, settings] = await Promise.all([getQuotation(id), getSettings()]);
  if (!q) return new Response("This quotation could not be found.", { status: 404 });

  const rendered = await renderToBuffer(<QuotationPdf view={viewFromSaved(q, settings)} />);
  const pdf = await stampPageNumbers(new Uint8Array(rendered), q.quoteNo);
  const download = new URL(request.url).searchParams.get("download") === "1";
  const filename = `Quotation-${q.quoteNo.replaceAll("/", "-")}.pdf`;
  return new Response(new Blob([pdf as BlobPart], { type: "application/pdf" }), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
