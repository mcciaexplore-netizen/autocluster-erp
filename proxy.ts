/**
 * Front door. Runs on the Node.js runtime (the Next.js 16 default).
 *
 * 1. Demo gate: when DEMO_PASSWORD is set (the demo site), the shared demo password comes first.
 * 2. Individual sign-in: without a sign-in cookie, pages go to /sign-in. This is only a quick
 *    check of the cookie; every page, server action, route and download checks the real
 *    session on the server (lib/auth/current-user.ts).
 */
import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { authEnabled, SESSION_COOKIE, verifySessionToken } from "@/lib/auth/demo-gate";
import { DEVICE_COOKIE, FLOOR_COOKIE } from "@/lib/auth/floor-cookies";

/** Pages and endpoints that work before signing in. */
const OPEN = ["/sign-in", "/api/auth", "/floor"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const back = pathname !== "/" ? `${pathname}${search}` : null;

  // Vercel Cron: no cookies; the route itself refuses anyone without the cron secret.
  if (pathname.startsWith("/api/cron/")) return NextResponse.next();

  if (authEnabled()) {
    const passedGate = verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
    if (pathname === "/login") return passedGate ? NextResponse.redirect(new URL("/", request.url)) : NextResponse.next();
    if (!passedGate) {
      const url = new URL("/login", request.url);
      if (back) url.searchParams.set("next", back);
      return NextResponse.redirect(url);
    }
  } else if (pathname === "/login") {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }

  if (OPEN.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  if (getSessionCookie(request, { cookiePrefix: "acdri" })) return NextResponse.next();

  // Shared shop-floor device: an operator's PIN session may use the app (the server limits it to
  // Today's work); with nobody signed in, the device shows the names on /floor.
  if (request.cookies.get(DEVICE_COOKIE)?.value) {
    if (request.cookies.get(FLOOR_COOKIE)?.value) return NextResponse.next();
    if (!pathname.startsWith("/api/")) return NextResponse.redirect(new URL("/floor", request.url));
  }

  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const url = new URL("/sign-in", request.url);
  if (back) url.searchParams.set("next", back);
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except Next.js build files and the browser icon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
