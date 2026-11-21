/** "Download as Excel" on the jobs list (same filters as the screen). */
import { isSignedIn } from "@/lib/auth-guard";
import { jobFiltersFromParams, listJobs } from "@/lib/planning-data";
import { jobsWorkbook } from "@/lib/planning/excel";
import { todayInIndia } from "@/lib/tickets";

export async function GET(request: Request) {
  if (!(await isSignedIn())) return Response.json({ error: "Please sign in again." }, { status: 401 });
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
