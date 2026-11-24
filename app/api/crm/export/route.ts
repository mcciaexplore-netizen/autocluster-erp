/** "Download as Excel" in the CRM list view: the enquiries matching the current filters and sort. */
import { routeAllow } from "@/lib/auth/guard";
import { getBoardLeads, getCrmStages } from "@/lib/crm-data";
import { exportLeadsWorkbook } from "@/lib/crm/excel";
import { filtersFromParams, matchesFilters, SORTS, sortLeads, todayInIndia, type SortKey } from "@/lib/crm/leads";

export async function GET(request: Request) {
  const gate = await routeAllow("crm.view");
  if (gate.denied) return gate.denied;
  const params = new URL(request.url).searchParams;
  const filters = filtersFromParams(params);
  const sortParam = params.get("sort");
  const sort: SortKey = sortParam && sortParam in SORTS ? (sortParam as SortKey) : "priority";
  const today = todayInIndia();
  const [leads, stages] = await Promise.all([getBoardLeads(), getCrmStages()]);
  const rows = sortLeads(leads.filter((l) => matchesFilters(l, filters, today)), sort);
  const filtered = [...params.keys()].some((k) => k !== "sort");
  const note = `${rows.length} of ${leads.length} enquiries${filtered ? " (filtered)" : ""}, downloaded ${today.split("-").reverse().join("/")}.`;
  const bytes = await exportLeadsWorkbook(rows, stages, note);
  return new Response(new Blob([bytes as BlobPart]), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Enquiries-${today}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
