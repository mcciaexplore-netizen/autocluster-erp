/** "Download as Excel" on each Planning Insights section. ?section=&from=&to=&dept= */
import { routeAllow } from "@/lib/auth/guard";
import { formatDate } from "@/lib/format";
import { insightTableWorkbook } from "@/lib/inventory/excel";
import { PLANNING_SECTIONS, planningTable, type PlanningSection } from "@/lib/planning/insights-tables";
import { getPlanningInsights, planningInsightFiltersFromParams } from "@/lib/planning-insights";

export async function GET(request: Request) {
  const gate = await routeAllow("insights.planning");
  if (gate.denied) return gate.denied;
  const sp = new URL(request.url).searchParams;
  const section = sp.get("section") as PlanningSection;
  if (!PLANNING_SECTIONS.includes(section)) return Response.json({ error: "Unknown table." }, { status: 400 });
  const f = await planningInsightFiltersFromParams(Object.fromEntries(sp));
  const t = planningTable(section, await getPlanningInsights(f));
  const note = `${section === "waiting" ? "Work waiting now" : `${formatDate(f.from)} to ${formatDate(f.to)}`} · ${f.dept ? `Department ${f.dept}` : "All departments"}`;
  const bytes = await insightTableWorkbook(t, note);
  return new Response(new Blob([bytes as BlobPart]), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${t.title.replace(/[^A-Za-z0-9]+/g, "-")}-${f.from}-to-${f.to}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
