/**
 * Demo sign-in ("Try it as...", "Switch role"): signs into a demo account without typing a password.
 * The account gets a fresh random password (never shown, stored only as a hash) that is used once,
 * here, to create a new session. Other sessions of the same demo account are never touched, and a
 * per-account database lock keeps two people pressing "Try it as Operator" at the same moment from
 * changing the password under each other.
 */
import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DB } from "../../db/client";
import type { Auth } from "./better-auth";

export async function demoSignIn(db: DB, auth: Auth, u: { id: string; authUserId: string; email: string }, headers: Headers) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`demo-sign-in:${u.id}`}))`);
    const password = randomBytes(24).toString("base64url");
    const ctx = await auth.$context;
    await ctx.internalAdapter.updatePassword(u.authUserId, await ctx.password.hash(password));
    return auth.api.signInEmail({ body: { email: u.email, password, rememberMe: false }, headers });
  });
}
