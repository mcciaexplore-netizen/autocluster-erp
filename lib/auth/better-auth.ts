/**
 * Individual sign-in (Better Auth). One factory, so the app and the terminal scripts
 * (users:create-admin, db:seed) build it the same way.
 *
 * - Email and password only. No sign-up: Admins create accounts (section 5).
 * - Sessions: 7 days with "Keep me signed in", otherwise until the browser closes.
 * - No session cookie cache: deactivating someone must end their sessions at once.
 * - Secret: AUTH_SECRET (already set on Vercel), read by Better Auth itself.
 * - Who may do what is decided by our own permissions (lib/auth/permissions.ts), not by
 *   Better Auth's admin roles, so its admin endpoints are only called from our server code.
 */
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins";
import type { DB, Tx } from "../../db/client";
import { authAccounts, authSessions, authUsers, authVerifications } from "../../db/schema";

export const SESSION_DAYS = 7;
export const MIN_PASSWORD = 10;

export function createAuth(db: DB | Tx, opts: { nextCookies?: unknown } = {}) {
  return betterAuth({
    appName: "AutoCluster ERP",
    baseURL: {
      // Live, every Preview and local development.
      allowedHosts: ["*.vercel.app", "localhost:*", "127.0.0.1:*", ...(process.env.APP_HOSTS ?? "").split(",").filter(Boolean)],
      fallback: process.env.BETTER_AUTH_URL || "http://localhost:3000",
    },
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: { user: authUsers, session: authSessions, account: authAccounts, verification: authVerifications },
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      autoSignIn: false,
      minPasswordLength: MIN_PASSWORD,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
    },
    session: { expiresIn: SESSION_DAYS * 24 * 60 * 60, updateAge: 24 * 60 * 60 },
    // Our own lockout and per-address limits live in lib/auth/sign-in-limits.ts.
    rateLimit: { enabled: false },
    advanced: { cookiePrefix: "acdri", useSecureCookies: process.env.NODE_ENV === "production" },
    telemetry: { enabled: false },
    // nextCookies() must be the last plugin; the app passes it in.
    plugins: [admin({ defaultRole: "user" }), ...((opts.nextCookies ? [opts.nextCookies] : []) as [])],
  });
}

export type Auth = ReturnType<typeof createAuth>;
