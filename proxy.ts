/**
 * Front door for the demo password. Runs on the Node.js runtime (the Next.js 16 default).
 * When DEMO_PASSWORD is not set (local development), everything is open.
 * Server actions and the PDF route also check the session themselves.
 */
import { NextResponse, type NextRequest } from "next/server";
import { authEnabled, SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

export function proxy(request: NextRequest) {
  if (!authEnabled()) return NextResponse.next();
  const { pathname, search } = request.nextUrl;
  const signedIn = verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);

  if (pathname === "/login") {
    return signedIn ? NextResponse.redirect(new URL("/", request.url)) : NextResponse.next();
  }
  if (signedIn) return NextResponse.next();

  const url = new URL("/login", request.url);
  if (pathname !== "/") url.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except Next.js build files and the browser icon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
