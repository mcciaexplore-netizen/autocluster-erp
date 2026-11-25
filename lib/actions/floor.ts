"use server";

/**
 * Shared shop-floor device (section 7): PIN sign-in and sign-out. These work before anyone is
 * signed in, so they check the device and the PIN themselves.
 */
import { cookies, headers } from "next/headers";
import { z } from "zod";
import { db } from "@/db";
import { logActivity } from "@/lib/activity";
import { DEVICE_COOKIE, pinSignIn } from "@/lib/auth/floor-core";
import { clearFloorCookie, setFloorCookie } from "@/lib/auth/floor-session";
import { auth } from "@/lib/auth/server";

export async function pinSignInAction(userId: string, pin: string): Promise<{ ok: true; name: string } | { ok: false; message: string }> {
  const id = z.string().uuid().safeParse(userId);
  if (!id.success) return { ok: false, message: "Please choose your name again." };
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
  const ctx = await auth.$context;
  const r = await pinSignIn(db, (hash, p) => ctx.password.verify({ hash, password: p }), {
    deviceToken: (await cookies()).get(DEVICE_COOKIE)?.value,
    userId: id.data,
    pin: String(pin ?? "").slice(0, 12),
    ip,
    now: new Date(),
  });
  if (!r.ok) {
    await logActivity({ area: "Sign-in", action: "failed sign-in", summary: `Failed PIN sign-in on a shared device: ${r.message}`, entityType: "user", entityId: id.data, userId: null });
    await new Promise((res) => setTimeout(res, 400));
    return r;
  }
  await setFloorCookie(r.session);
  await logActivity({ area: "Sign-in", action: "signed in", summary: `Signed in with PIN on shared device "${r.deviceName}"`, entityType: "user", entityId: id.data, userId: id.data });
  return { ok: true, name: r.name };
}

/** After their action, or 10 idle minutes: back to the names. */
export async function floorSignOutAction() {
  await clearFloorCookie();
  return { ok: true as const };
}
