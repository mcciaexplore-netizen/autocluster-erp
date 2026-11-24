"use server";

import { and, eq, ne } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { appUsers, authSessions, authUsers, teamMembers } from "@/db/schema";
import { safeNextPath } from "@/lib/auth/demo-gate";
import { getCurrentUser } from "@/lib/auth/current-user";
import { passwordProblem } from "@/lib/auth/password-rules";
import { auth } from "@/lib/auth/server";

export type FormState = { error: string | null; ok?: string | null };

const WRONG = "Email or password is not right.";

/** Sign in with email and password. "Keep me signed in" keeps the session for 7 days. */
export async function signInWithPassword(_prev: FormState, fd: FormData): Promise<FormState> {
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const password = String(fd.get("password") ?? "");
  const remember = fd.get("remember") === "on";
  const next = safeNextPath(fd.get("next"));
  if (!email || !password) return { error: "Please type your email and password." };

  const [u] = await db.select().from(appUsers).where(eq(appUsers.email, email));
  // The same answer whether the email is unknown, deactivated or the password is wrong.
  if (!u || !u.canSignIn || u.deactivatedAt || !u.authUserId) {
    await new Promise((r) => setTimeout(r, 600));
    return { error: WRONG };
  }
  try {
    await auth.api.signInEmail({ body: { email, password, rememberMe: remember }, headers: await headers() });
  } catch {
    await new Promise((r) => setTimeout(r, 600));
    return { error: WRONG };
  }
  await db.update(appUsers).set({ lastSignInAt: new Date() }).where(eq(appUsers.id, u.id));
  redirect(u.mustChangePassword ? `/change-password?next=${encodeURIComponent(next)}` : next);
}

export async function signOutAction() {
  try {
    await auth.api.signOut({ headers: await headers() });
  } catch {
    // Already signed out.
  }
  redirect("/sign-in");
}

/** Sets a new password for the signed-in person (hashed by Better Auth) and ends their other sessions. */
async function setOwnPassword(userId: string, authUserId: string, sessionId: string, password: string) {
  const ctx = await auth.$context;
  await ctx.internalAdapter.updatePassword(authUserId, await ctx.password.hash(password));
  await db.delete(authSessions).where(and(eq(authSessions.userId, authUserId), ne(authSessions.id, sessionId)));
  await db.update(appUsers).set({ mustChangePassword: false, updatedAt: new Date() }).where(eq(appUsers.id, userId));
}

/** First sign-in with a temporary password: "Choose your new password". */
export async function chooseNewPassword(_prev: FormState, fd: FormData): Promise<FormState> {
  const me = await getCurrentUser();
  if (!me) redirect("/sign-in");
  const password = String(fd.get("password") ?? "");
  const again = String(fd.get("again") ?? "");
  const problem = passwordProblem(password, { name: me.name, email: me.email });
  if (problem) return { error: problem };
  if (password !== again) return { error: "The two passwords don't match." };
  await setOwnPassword(me.id, me.authUserId, me.sessionId, password);
  redirect(safeNextPath(fd.get("next")));
}

/** Profile: change password (asks for the current one). */
export async function changePassword(_prev: FormState, fd: FormData): Promise<FormState> {
  const me = await getCurrentUser();
  if (!me) return { error: "You have been signed out. Please sign in again." };
  const current = String(fd.get("current") ?? "");
  const password = String(fd.get("password") ?? "");
  const again = String(fd.get("again") ?? "");
  if (!current) return { error: "Please type your current password." };
  const ctx = await auth.$context;
  const account = (await ctx.internalAdapter.findAccounts(me.authUserId)).find((a) => a.providerId === "credential");
  if (!account?.password || !(await ctx.password.verify({ hash: account.password, password: current }))) return { error: "Your current password is not right." };
  const problem = passwordProblem(password, { name: me.name, email: me.email });
  if (problem) return { error: problem };
  if (password !== again) return { error: "The two new passwords don't match." };
  await setOwnPassword(me.id, me.authUserId, me.sessionId, password);
  return { error: null, ok: "Password changed. Your other devices have been signed out." };
}

/** Profile: name and mobile. Kept in step with the team list, so pickers show the same name. */
export async function updateProfile(_prev: FormState, fd: FormData): Promise<FormState> {
  const me = await getCurrentUser();
  if (!me) return { error: "You have been signed out. Please sign in again." };
  const name = String(fd.get("name") ?? "").trim().replace(/\s+/g, " ");
  const mobile = String(fd.get("mobile") ?? "").replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
  if (name.length < 2) return { error: "Please enter your full name." };
  if (name.length > 80) return { error: "Keep the name under 80 characters." };
  if (mobile && !/^[6-9]\d{9}$/.test(mobile)) return { error: "Enter a 10-digit mobile number, e.g. 98220 12345." };
  await db.transaction(async (tx) => {
    await tx.update(appUsers).set({ fullName: name, mobile: mobile || null, updatedAt: new Date() }).where(eq(appUsers.id, me.id));
    await tx.update(authUsers).set({ name, updatedAt: new Date() }).where(eq(authUsers.id, me.authUserId));
    await tx.update(teamMembers).set({ name, phone: mobile || null }).where(eq(teamMembers.id, me.teamMemberId));
  });
  return { error: null, ok: "Saved." };
}

/** Profile: "Sign out of this device" for one of the listed sessions. */
export async function signOutSession(sessionId: string): Promise<FormState> {
  const me = await getCurrentUser();
  if (!me) return { error: "You have been signed out. Please sign in again." };
  await db.delete(authSessions).where(and(eq(authSessions.id, sessionId), eq(authSessions.userId, me.authUserId)));
  if (sessionId === me.sessionId) redirect("/sign-in");
  return { error: null, ok: "Signed out of that device." };
}

/** Profile: "Sign out of all devices", including this one. */
export async function signOutEverywhere() {
  const me = await getCurrentUser();
  if (me) await db.delete(authSessions).where(eq(authSessions.userId, me.authUserId));
  redirect("/sign-in");
}
