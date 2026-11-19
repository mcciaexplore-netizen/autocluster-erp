/**
 * Shows an uploaded PO or tax invoice, only to signed-in users.
 * The file is streamed from private Blob storage; the storage link never reaches the browser.
 */
import { get } from "@vercel/blob";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { files } from "@/db/schema";
import { isSignedIn } from "@/lib/auth-guard";
import { blobAuth, blobConfigured } from "@/lib/blob";

export async function GET(request: Request, ctx: RouteContext<"/api/files/[id]">) {
  if (!(await isSignedIn())) {
    const url = new URL(request.url);
    const login = new URL("/login", url);
    login.searchParams.set("next", url.pathname);
    return Response.redirect(login, 303);
  }
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("This file could not be found.", { status: 404 });
  const [f] = await db.select().from(files).where(eq(files.id, id));
  if (!f) return new Response("This file could not be found.", { status: 404 });
  if (!blobConfigured()) return new Response("File storage isn't set up on this copy of the app.", { status: 503 });

  const blob = await get(f.blobPath, { access: "private", ...blobAuth() }).catch((e) => {
    console.error("file get", e);
    return null;
  });
  if (!blob || blob.statusCode !== 200) return new Response("This file is no longer available.", { status: 404 });

  const download = new URL(request.url).searchParams.get("download") === "1";
  const ascii = f.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  return new Response(blob.stream, {
    headers: {
      "Content-Type": f.mime,
      "Content-Length": String(blob.blob.size),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(f.fileName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
