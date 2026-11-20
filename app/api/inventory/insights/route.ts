/** "Download as Excel" on each Insights table. ?section=&from=&to=&dept= */
import { isSignedIn } from "@/lib/auth-guard";
import { formatDate } from "@/lib/format";
import { getInsights, insightFiltersFromParams } from "@/lib/inventory-insights";
import { insightTableWorkbook } from "@/lib/inventory/excel";
import { INSIGHT_SECTIONS, insightTable, type InsightSection } from "@/lib/inventory/insights-tables";

export async function GET(request: Request) {
  if (!(await isSignedIn())) return Response.json({ error: "Please sign in again." }, { status: 401 });
  const sp = new URL(request.url).searchParams;
  const section = sp.get("section") as InsightSection;
  if (!INSIGHT_SECTIONS.includes(section)) return Response.json({ error: "Unknown table." }, { status: 400 });
  const f = await insightFiltersFromParams(Object.fromEntries(sp));
  const t = insightTable(section, await getInsights(f));
  const now = section === "tied-up" || section === "running-out";
  const note = `${now ? "Stock now" : `${formatDate(f.from)} to ${formatDate(f.to)}`} · ${f.dept ? `Department ${f.dept}` : "All departments"}`;
  const bytes = await insightTableWorkbook(t, note);
  return new Response(new Blob([bytes as BlobPart]), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${t.title.replace(/[^A-Za-z0-9]+/g, "-")}-${f.from}-to-${f.to}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
