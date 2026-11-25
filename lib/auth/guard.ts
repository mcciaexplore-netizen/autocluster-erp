/**
 * Server-side permission checks (section 3.4). Every server action, route handler, file download,
 * Excel export and page data loader goes through one of these. Hiding buttons is never enough.
 */
import "server-only";
import { forbidden, redirect } from "next/navigation";
import { SIGNED_OUT_MESSAGE } from "@/lib/auth-messages";
import { can, canAny } from "./can";
import { getCurrentUser, type CurrentUser } from "./current-user";
import { touchFloor } from "./floor-session";
import { PERMISSIONS, type Permission } from "./permissions";

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** "You don't have permission to record payments, reminders and follow-ups. Ask your admin if you need it." */
export function denyMessage(perm: Permission, dept?: string | null | string[]): string {
  if (dept !== undefined) {
    const d = Array.isArray(dept) ? dept.join(" / ") : dept;
    return d ? `You can only do this in your own departments, and this is ${d}. Ask your admin if you need it.` : "You can only do this in your own departments. Ask your admin if you need it.";
  }
  return `You don't have permission to ${lower(PERMISSIONS[perm].label)}. Ask your admin if you need it.`;
}

export const CHANGE_PASSWORD_FIRST = "Please choose your new password first. Reload the page to do it.";

export type Allowed = { ok: true; me: CurrentUser } | { ok: false; message: string };

/** The signed-in person (not still on a temporary password), or null. */
export async function signedInUser(): Promise<CurrentUser | null> {
  const me = await getCurrentUser();
  return me && !me.mustChangePassword ? me : null;
}

/**
 * For server actions: { ok: true, me } or { ok: false, message } to show as it is.
 * Pass several permissions to allow any one of them. `dept` limits a scoped permission.
 */
export async function allow(perm: Permission | Permission[], opts: { dept?: string | null | string[] } = {}): Promise<Allowed> {
  const raw = await getCurrentUser();
  if (raw?.mustChangePassword) return { ok: false, message: CHANGE_PASSWORD_FIRST };
  const me = raw;
  if (!me) return { ok: false, message: SIGNED_OUT_MESSAGE };
  const perms = Array.isArray(perm) ? perm : [perm];
  if (perms.some((p) => can(me, p, opts))) {
    await touchFloor(me); // a shop-floor PIN session stays open 10 minutes from its last action
    return { ok: true, me };
  }
  const hasAnywhere = "dept" in opts && perms.some((p) => can(me, p));
  return { ok: false, message: denyMessage(perms[0], hasAnywhere ? opts.dept : undefined) };
}

/**
 * For page data loaders: the signed-in person, if they may view this. Signed out: to sign-in.
 * Not allowed: forbidden(), the friendly no-access page (pages check the area first, so this is the safety net).
 */
export async function need(perm: Permission | Permission[] = []): Promise<CurrentUser> {
  const raw = await getCurrentUser();
  // Still on a temporary password: nothing else until they choose their own.
  if (raw?.mustChangePassword) redirect("/change-password");
  const me = raw;
  if (!me) redirect("/sign-in");
  const perms = Array.isArray(perm) ? perm : [perm];
  // Not allowed: the friendly no-access page (forbidden.tsx), with no error in the server log.
  if (perms.length && !canAny(me, perms)) forbidden();
  return me;
}

/** For summaries (e.g. Home cards): the person if they may see this, otherwise null (show nothing). */
export async function may(perm: Permission | Permission[]): Promise<CurrentUser | null> {
  const me = await signedInUser();
  const perms = Array.isArray(perm) ? perm : [perm];
  return me && canAny(me, perms) ? me : null;
}

/** For route handlers (downloads, exports): the person, or a Response to return as it is. */
export async function routeAllow(perm: Permission | Permission[], opts: { dept?: string | null | string[] } = {}): Promise<{ me: CurrentUser; denied?: undefined } | { me?: undefined; denied: Response }> {
  const r = await allow(perm, opts);
  if (r.ok) return { me: r.me };
  const signedOut = r.message === SIGNED_OUT_MESSAGE;
  return { denied: Response.json({ error: signedOut ? "Please sign in again." : r.message }, { status: signedOut ? 401 : 403 }) };
}

/** Money the person may see (section 3.1). Fields they can't see are removed on the server. */
export function moneyView(me: { grants: CurrentUser["grants"] } | null) {
  return { sale: can(me, "money.sale_prices"), stock: can(me, "money.stock_costs") };
}
