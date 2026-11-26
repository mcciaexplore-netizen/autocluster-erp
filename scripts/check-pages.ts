/**
 * Page safety check (npm run test:pages): opens every page on the dev server in every state and
 * fails on any Next.js error, either in the page or printed in the server console. This catches what
 * only the dev server reports, such as "Next.js encountered the unstable value Date.now() while
 * prerendering" (Cache Components rules), which a build or a browser-only check can miss.
 *
 * States: signed out; signed in as each demo role (the same kind of session "Try it as" makes); a
 * shared shop-floor device with nobody signed in; a PIN session on it; an Admin on it.
 *
 * PAGES_STATES="shared device" checks only the states whose names contain that text (comma-separated).
 *
 * Runs against the local demo database only (DEMO_MODE=true, a localhost DATABASE_URL). It starts its
 * own dev server, or uses one already running when BASE and DEV_LOG (that server's log file) are set.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { TRY_AS_ROLES } from "../db/demo-users";
import { COMING_SOON } from "../lib/coming-soon";
import { appUsers, sharedDevices } from "../db/schema";
import { createAuth } from "../lib/auth/better-auth";
import { createSessionToken, SESSION_COOKIE } from "../lib/auth/demo-gate";
import { isDemoMode } from "../lib/auth/demo-mode";
import { DEVICE_COOKIE, FLOOR_COOKIE, floorExpiry, hashToken, newDeviceToken, signFloor } from "../lib/auth/floor-core";
import { scriptDb } from "./demo-data";

const PORT = Number(process.env.PAGES_PORT ?? 3107);
const ERROR_LINE = /(^|\s)(Error:|⨯|Unhandled|TypeError|ReferenceError)|unstable value|while prerendering|Hydration failed/;

/** Every page in app/, as a URL pattern ("/crm/enquiries/[id]"). Route groups like (app) don't count. */
function pages(dir = path.resolve("app"), base = ""): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) {
      if (e.name === "api" || e.name.startsWith("_")) return [];
      const seg = /^\(.*\)$/.test(e.name) ? "" : `/${e.name}`;
      return pages(path.join(dir, e.name), base + seg);
    }
    return e.name === "page.tsx" ? [base || "/"] : [];
  });
}

async function main() {
  if (!isDemoMode()) throw new Error("Run this against the local demo database (DEMO_MODE=true).");
  const { db, pool } = scriptDb();
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || "";
  if (!/localhost|127\.0\.0\.1/.test(url) && !process.env.PAGES_ALLOW_REMOTE) throw new Error("This check signs in as demo users and marks a device as shared: local database only.");
  const auth = createAuth(db);
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set.");

  // ---- real ids for the [id] pages ----
  const one = async (q: ReturnType<typeof sql>) => (await db.execute<{ id: string }>(q)).rows[0]?.id;
  const ids: Record<string, string | undefined> = {
    "/crm/enquiries/[id]": await one(sql`select id from leads where deleted_at is null limit 1`),
    "/customers/[id]": await one(sql`select id from customers where deleted_at is null limit 1`),
    "/quotations/[id]": await one(sql`select id from quotations where deleted_at is null limit 1`),
    // An RPT machine: every demo person may see RPT (a machine of another department is refused on purpose).
    "/planning/machines/[id]": await one(sql`select id from machines where dept_code = 'RPT' limit 1`),
    "/inventory/items/[id]": await one(sql`select id from inv_items limit 1`),
    "/inventory/suppliers/[id]": await one(sql`select id from inv_suppliers limit 1`),
    "/inventory/movements/[id]": await one(sql`select id from inv_documents limit 1`),
    "/inventory/counts/[id]": await one(sql`select id from inv_counts limit 1`),
    "/settings/users/[id]": await one(sql`select id from app_users limit 1`),
    "/settings/roles/[id]": await one(sql`select id::text as id from roles limit 1`),
    "/soon/[slug]": COMING_SOON[0]?.slug,
  };
  const urls: string[] = [];
  const problems: string[] = [];
  for (const p of pages()) {
    if (!p.includes("[")) {
      urls.push(p);
      continue;
    }
    const key = Object.keys(ids).find((k) => p.startsWith(k));
    const id = key ? ids[key] : undefined;
    if (!key || !id) problems.push(`No record to open ${p} with: add it to the ids list in scripts/check-pages.ts`);
    else urls.push(p.replace(/\[[^\]]+\]/, id));
    // Every coming-soon page, not just the first.
    if (key === "/soon/[slug]") for (const m of COMING_SOON.slice(1)) urls.push(`/soon/${m.slug}`);
  }

  // ---- the states ----
  const cookieFrom = (res: Response) =>
    res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .filter((c) => c.includes("session_token"))
      .join("; ");
  const signIn = async (name: string) => {
    const [u] = await db.select().from(appUsers).where(eq(appUsers.fullName, name));
    if (!u?.authUserId || !u.email) throw new Error(`Demo user ${name} is missing: run db:reset first.`);
    const password = randomBytes(24).toString("base64url");
    const ctx = await auth.$context;
    await ctx.internalAdapter.updatePassword(u.authUserId, await ctx.password.hash(password));
    const res = (await auth.api.signInEmail({ body: { email: u.email, password, rememberMe: false }, asResponse: true })) as Response;
    const c = cookieFrom(res);
    if (!c) throw new Error(`Could not sign in as ${name}.`);
    return { cookie: c, user: u };
  };
  const gate = process.env.DEMO_PASSWORD ? `${SESSION_COOKIE}=${createSessionToken(Date.now())}` : "";
  const deviceToken = newDeviceToken();
  const [device] = await db.insert(sharedDevices).values({ name: "Page check (temporary)", deptCodes: ["RPT"], tokenHash: hashToken(deviceToken) }).returning();
  const deviceCookie = `${DEVICE_COOKIE}=${deviceToken}`;
  const states: { name: string; cookie: string }[] = [{ name: "signed out", cookie: gate }];
  for (const r of TRY_AS_ROLES) states.push({ name: `${r.role} (${r.name})`, cookie: [gate, (await signIn(r.name)).cookie].filter(Boolean).join("; ") });
  const rohan = await signIn("Rohan Deshpande");
  const floor = `${FLOOR_COOKIE}=${signFloor({ u: rohan.user.id, d: device.id, exp: floorExpiry(Date.now()) + 50 * 60_000 }, secret)}`;
  states.push({ name: "shared device, nobody signed in", cookie: [gate, deviceCookie].filter(Boolean).join("; ") });
  states.push({ name: "shared device, PIN session (Rohan)", cookie: [gate, deviceCookie, floor].filter(Boolean).join("; ") });
  states.push({ name: "shared device, Admin signed in", cookie: [gate, deviceCookie, (await signIn("Demo Admin")).cookie].filter(Boolean).join("; ") });

  // PAGES_STATES="shared device" (comma-separated parts of state names) checks only those states.
  const only = (process.env.PAGES_STATES ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (only.length) states.splice(0, states.length, ...states.filter((st) => only.some((o) => st.name.toLowerCase().includes(o))));
  if (!states.length) throw new Error(`No state matches PAGES_STATES="${process.env.PAGES_STATES}".`);

  // ---- the dev server ----
  let server: ChildProcess | null = null;
  let base = process.env.BASE ?? "";
  let readLog: () => string;
  if (base && process.env.DEV_LOG) {
    const file = process.env.DEV_LOG;
    readLog = () => fs.readFileSync(file, "utf8");
  } else {
    base = `http://localhost:${PORT}`;
    let out = "";
    // Hundreds of page renders: give the dev server room.
    server = spawn("npx", ["next", "dev", "-p", String(PORT)], { env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --max-old-space-size=6144`.trim() }, stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });
    server.stdout?.on("data", (d) => (out += d));
    server.stderr?.on("data", (d) => (out += d));
    readLog = () => out;
    for (let i = 0; i < 120; i++) {
      if (/Another next dev server is already running|EADDRINUSE/.test(out)) throw new Error("Another dev server is running here. Stop it, or set BASE and DEV_LOG to use it.");
      try {
        if ((await fetch(`${base}/sign-in`, { redirect: "manual" })).status < 500) break;
      } catch {
        /* still starting */
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  // ---- open every page in every state ----
  let opened = 0;
  try {
    for (const st of states) {
      for (const u of urls) {
        const before = readLog().length;
        let status = 0;
        let body = "";
        try {
          const res = await fetch(base + u, { headers: { cookie: st.cookie }, redirect: "manual" });
          status = res.status;
          body = await res.text();
        } catch (e) {
          problems.push(`${st.name}: ${u} could not load (${e instanceof Error ? e.message : e})`);
          continue;
        }
        opened++;
        await new Promise((r) => setTimeout(r, 150)); // let the server finish writing its log
        const logged = readLog().slice(before).split("\n").filter((l) => ERROR_LINE.test(l));
        if (status >= 500) problems.push(`${st.name}: ${u} answered ${status}`);
        if (body.includes('id="__next_error__"')) problems.push(`${st.name}: ${u} showed a Next.js error page`);
        // A "no access" page in an area this person's own menu offers is a bug (e.g. a loader asking for a permission
        // the page doesn't need). Adding, editing, importing and Insights can legitimately be refused inside an area.
        // (The menu streams in after the first HTML, so its links are looked for anywhere in the page.)
        const area = `/${u.split("/")[1] ?? ""}`;
        // The friendly page is drawn in the browser when the refusal comes after streaming starts: look for Next's marker too.
        const refused = /You don(&#x27;|')t have access to/.test(body) || body.includes("NEXT_HTTP_ERROR_FALLBACK;403");
        if (refused && area !== "/" && body.includes(`href="${area}"`) && !/\/(new|edit|import)(\/|$)|\/insights/.test(u)) problems.push(`${st.name}: ${u} showed "no access" although their menu offers ${area}`);
        if (logged.length) problems.push(`${st.name}: ${u} printed in the server console:\n      ${logged.slice(0, 3).map((l) => l.trim().slice(0, 220)).join("\n      ")}`);
      }
      console.log(`  ${st.name}: ${urls.length} pages opened`);
    }
  } finally {
    server?.kill();
    await db.update(sharedDevices).set({ revokedAt: new Date() }).where(eq(sharedDevices.id, device.id));
    await pool.end();
  }
  console.log(`\nOpened ${opened} pages in ${states.length} states.`);
  if (problems.length) {
    console.log(`\n${problems.length} problem(s):\n  ${problems.join("\n  ")}`);
    process.exitCode = 1;
  } else console.log("No Next.js errors and nothing printed in the server console.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
