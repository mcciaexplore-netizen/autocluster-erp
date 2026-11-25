/** Cookies for shared shop-floor devices and PIN sessions (server only). */
import "server-only";
import { cookies } from "next/headers";
import { DEVICE_COOKIE, DEVICE_COOKIE_DAYS, FLOOR_COOKIE, FLOOR_IDLE_MINUTES, floorExpiry, signFloor, type FloorSession } from "./floor-core";

const base = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/" };

export async function setFloorCookie(s: FloorSession) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  (await cookies()).set(FLOOR_COOKIE, signFloor(s, secret), { ...base, maxAge: FLOOR_IDLE_MINUTES * 60 });
}

export async function clearFloorCookie() {
  (await cookies()).delete(FLOOR_COOKIE);
}

export async function setDeviceCookie(token: string) {
  (await cookies()).set(DEVICE_COOKIE, token, { ...base, maxAge: DEVICE_COOKIE_DAYS * 86_400 });
}

export async function clearDeviceCookie() {
  (await cookies()).delete(DEVICE_COOKIE);
}

/** Each action starts the 10 idle minutes again. Only works inside a server action. */
export async function touchFloor(me: { id: string; floor?: { deviceId: string } }) {
  if (!me.floor) return;
  try {
    await setFloorCookie({ u: me.id, d: me.floor.deviceId, exp: floorExpiry() });
  } catch {
    /* not in an action (a page render): nothing to refresh */
  }
}
