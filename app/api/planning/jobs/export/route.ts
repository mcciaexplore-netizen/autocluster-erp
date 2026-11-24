/** "Download as Excel" on the jobs list (same filters as the screen). */
import { routeAllow } from "@/lib/auth/guard";
import { jobFiltersFromParams, listJobs } from "@/lib/planning-data";
import { jobsWorkbook } from "@/lib/planning/excel";
import { todayInIndia } from "@/lib/tickets";

export async function GET(request: Request) {
  const gate = await routeAllow("planning.view");
  if (gate.denied) return gate.denied;
  const sp = Object.fromEntries(new URL(request.url).searchParams);
  const f = jobFiltersFromParams(sp);
  const rows = await listJobs(f, 5000);
  const today = todayInIndia();
  const bytes = await jobsWorkbook(rows, `Downloaded ${today.split("-").reverse().join("/")} · ${Object.keys(sp).length ? "with the filters from the screen" : "all jobs"}`);
  return new Response(new Blob([bytes as BlobPart]), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Jobs-${today}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
