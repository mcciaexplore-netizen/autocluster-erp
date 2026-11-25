/**
 * The demo site's outer gate: one shared demo password, before individual sign-in.
 *
 * - Off when DEMO_PASSWORD is not set (local development).
 * - On sign-in we store a signed token in a cookie, never the password.
 *   The token is "<payload>.<signature>", where the signature is an HMAC-SHA256
 *   made with a key derived from AUTH_SECRET and DEMO_PASSWORD. Changing either
 *   one signs everybody out.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { isDemoMode } from "./demo-mode";

export const SESSION_COOKIE = "acdri_session";
export const SESSION_DAYS = 7;
const SESSION_SECONDS = SESSION_DAYS * 24 * 60 * 60;

/** The shared demo password gate: only on the demo site (demo mode with DEMO_PASSWORD set). */
export function authEnabled(): boolean {
  return isDemoMode() && !!process.env.DEMO_PASSWORD;
}

/** Problem with the server's own setup, in plain words, or null when it is fine. */
export function authSetupProblem(): string | null {
  if (!authEnabled()) return null;
  const secret = process.env.AUTH_SECRET ?? "";
  if (secret.length < 32) return "This site is not fully set up yet (AUTH_SECRET is missing or too short). Please ask the administrator.";
  return null;
}

function signingKey(): Buffer {
  return createHash("sha256")
    .update(`${process.env.AUTH_SECRET ?? ""}\u0000${process.env.DEMO_PASSWORD ?? ""}`)
    .digest();
}

function sign(payload: string): string {
  return createHmac("sha256", signingKey()).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function createSessionToken(now: number): string {
  const payload = Buffer.from(JSON.stringify({ v: 1, exp: Math.floor(now / 1000) + SESSION_SECONDS })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string | undefined | null, now: number): boolean {
  if (!token || authSetupProblem()) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig || !safeEqual(sig, sign(payload))) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp: number };
    return typeof exp === "number" && exp > Math.floor(now / 1000);
  } catch {
    return false;
  }
}

/** Compares the typed password with DEMO_PASSWORD in constant time. */
export function passwordMatches(input: string): boolean {
  const expected = process.env.DEMO_PASSWORD;
  if (!expected) return false;
  const a = createHash("sha256").update(input).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_SECONDS,
};

/** Only allow redirects back to a page on this site. */
export function safeNextPath(next: unknown): string {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}
