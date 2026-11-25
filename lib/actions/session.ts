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
import { logActivity } from "@/lib/activity";
import { checkSignIn } from "@/lib/auth/sign-in-flow";
import { pinProblem } from "@/lib/auth/floor-core";

export type FormState = { error: string | null; ok?: string | null };

/** The IP address of this request (Vercel puts the caller's address first). */
async function requestIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
}

/** Sign in with email and password. "Keep me signed in" keeps the session for 7 days. */
export async function signInWithPassword(_prev: FormState, fd: FormData): Promise<FormState> {
  const email = String(fd.get("email") ?? "").trim().toLowerCase().slice(0, 200);
  const password = String(fd.get("password") ?? "");
  const remember = fd.get("remember") === "on";
  const next = safeNextPath(fd.get("next"));
  if (!email || !password) return { error: "Please type your email and password." };

  const h = await headers();
  const r = await checkSignIn(
    db,
    { email, ip: await requestIp() },
    async () => {
      try {
        await auth.api.signInEmail({ body: { email, password, rememberMe: remember }, headers: h });
        return true;
      } catch {
        return false;
      }
    },
    (e) => logActivity({ area: "Sign-in", action: e.success ? "signed in" : "failed sign-in", summary: e.summary, entityType: "user", entityId: e.userId, userId: e.userId }),
  );
  if (!r.ok) {
    await new Promise((res) => setTimeout(res, 600)); // slows down guessing
    return { error: r.message };
  }
  redirect(r.user.mustChangePassword ? `/change-password?next=${encodeURIComponent(next)}` : next);
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
  await logActivity({ area: "Sign-in", action: "password changed", summary: "Changed their own password (other devices signed out)", entityType: "user", entityId: userId });
}

/** First sign-in with a temporary password: "Choose your new password". */
export async function chooseNewPassword(_prev: FormState, fd: FormData): Promise<FormState> {
  const me = await getCurrentUser();
  if (!me || me.floor) redirect("/sign-in");
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
  // A shop-floor PIN session can't change account details.
  const me = await getCurrentUser();
  if (!me || me.floor) return { error: "You have been signed out. Please sign in again." };
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
  // A shop-floor PIN session can't change account details.
  const me = await getCurrentUser();
  if (!me || me.floor) return { error: "You have been signed out. Please sign in again." };
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
  // A shop-floor PIN session can't change account details.
  const me = await getCurrentUser();
  if (!me || me.floor) return { error: "You have been signed out. Please sign in again." };
  await db.delete(authSessions).where(and(eq(authSessions.id, sessionId), eq(authSessions.userId, me.authUserId)));
  if (sessionId === me.sessionId) redirect("/sign-in");
  return { error: null, ok: "Signed out of that device." };
}

/** Profile: "Sign out of all devices", including this one. */
export async function signOutEverywhere() {
  const me = await getCurrentUser();
  if (me && !me.floor) {
    await db.delete(authSessions).where(eq(authSessions.userId, me.authUserId));
    await logActivity({ area: "Sign-in", action: "signed out", summary: "Signed out of all devices", entityType: "user", entityId: me.id });
  }
  redirect("/sign-in");
}

/** Profile: "Shop-floor PIN" (4-6 digits) for shared devices on the shop floor. Stored only as a hash. */
export async function setOwnPin(_prev: FormState, fd: FormData): Promise<FormState> {
  const me = await getCurrentUser();
  if (!me || me.floor) return { error: "You have been signed out. Please sign in again." };
  if (me.mustChangePassword) return { error: "Please choose your new password first." };
  const pin = String(fd.get("pin") ?? "");
  const again = String(fd.get("again") ?? "");
  const problem = pinProblem(pin);
  if (problem) return { error: problem };
  if (pin !== again) return { error: "The two PINs don't match." };
  const ctx = await auth.$context;
  await db.update(appUsers).set({ pinHash: await ctx.password.hash(pin), updatedAt: new Date() }).where(eq(appUsers.id, me.id));
  await logActivity({ area: "Sign-in", action: "pin", summary: "Set their own shop-floor PIN", entityType: "user", entityId: me.id });
  return { error: null, ok: "PIN saved. Use it on the shop-floor tablet." };
}
