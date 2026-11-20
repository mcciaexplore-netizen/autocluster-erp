/** "Download as Excel" on Stock in & out: every line of the records matching the filters. */
import { isSignedIn } from "@/lib/auth-guard";
import { docFiltersFromParams, getLinesForDocs, listInvDocuments } from "@/lib/inventory-data";
import { movementsWorkbook } from "@/lib/inventory/excel";
import { todayInIndia } from "@/lib/tickets";

export async function GET(request: Request) {
  if (!(await isSignedIn())) return Response.json({ error: "Please sign in again." }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const f = docFiltersFromParams(Object.fromEntries(params.entries()));
  const docs = await listInvDocuments(f, 5000);
  const lines = await getLinesForDocs(docs.map((d) => d.id));
  const today = todayInIndia();
  const bytes = await movementsWorkbook(docs, lines, `${docs.length} records${[...params.keys()].length ? " (filtered)" : ""}, downloaded ${today.split("-").reverse().join("/")}.`);
  return new Response(new Blob([bytes as BlobPart]), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Stock-in-and-out-${today}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
