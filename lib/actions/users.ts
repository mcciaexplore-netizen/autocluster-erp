"use server";

import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { UserFacingError } from "@/db/quote-writer";
import { copyRole, deleteRole, saveRole } from "@/db/role-writer";
import { deactivateUser, reactivateUser, resetUserPassword, saveUser, signOutUserEverywhere } from "@/db/user-writer";
import { logActivity } from "@/lib/activity";
import { allow } from "@/lib/auth/guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { temporaryPassword } from "@/lib/auth/password-rules";
import { auth } from "@/lib/auth/server";
import { cookies } from "next/headers";
import { and, eq, isNull } from "drizzle-orm";
import { appUsers, sharedDevices } from "@/db/schema";
import { DEVICE_COOKIE, findDevice, hashToken, newDeviceToken, pinProblem } from "@/lib/auth/floor-core";
import { clearDeviceCookie, setDeviceCookie } from "@/lib/auth/floor-session";

type Result<T> = { ok: true; data: T } | { ok: false; message: string };

const tempPassword = () => temporaryPassword((n) => randomInt(n));

/** Every action here needs "users.manage". */
async function run<T>(fn: () => Promise<T>): Promise<Result<T>> {
  const g = await allow("users.manage");
  if (!g.ok) return { ok: false, message: g.message };
  try {
    const data = await fn();
    revalidatePath("/", "layout");
    return { ok: true, data };
  } catch (e) {
    if (e instanceof UserFacingError) return { ok: false, message: e.message };
    if (e instanceof z.ZodError) return { ok: false, message: e.issues[0]?.message ?? "Please check the details." };
    const msg = e instanceof Error ? e.message : "";
    if (/already exists|USER_ALREADY_EXISTS/i.test(msg)) return { ok: false, message: "Someone already uses this email address." };
    console.error("users", e);
    return { ok: false, message: "We couldn't save that right now. Please try again." };
  }
}

const uuid = z.string().uuid();
const userSchema = z.object({
  name: z.string().max(200),
  canSignIn: z.boolean(),
  email: z.string().max(200).nullable(),
  mobile: z.string().max(20).nullable(),
  roleIds: z.array(z.number().int().positive()).max(50),
  allDepartments: z.boolean(),
  deptCodes: z.array(z.string().max(10)).max(20),
  maxMachines: z.number().nullable().optional(),
});

/** Add or change a person. A temporary password, when one was made, is returned once and never stored. */
export async function saveUserAction(id: string | null, input: z.input<typeof userSchema>) {
  return run(async () => {
    const v = userSchema.parse(input);
    const r = await saveUser(db, auth, id ? uuid.parse(id) : null, v, tempPassword);
    if (r.created || r.changes.length) {
      await logActivity({ area: "Users", action: r.created ? "created" : "changed", entityType: "user", entityId: r.id, summary: r.created ? `Added ${v.name.trim()}${v.canSignIn ? " (can sign in)" : " (name only)"}` : `Changed ${v.name.trim()}: ${r.changes.join(", ")}` });
    }
    return { id: r.id, tempPassword: r.tempPassword };
  });
}

export async function resetPasswordAction(id: string) {
  return run(async () => {
    const r = await resetUserPassword(db, auth, uuid.parse(id), tempPassword);
    await logActivity({ area: "Users", action: "password reset", entityType: "user", entityId: id, summary: `Reset the password of ${r.name} (temporary password given; their devices were signed out)` });
    return { tempPassword: r.tempPassword };
  });
}

export async function deactivateUserAction(id: string) {
  return run(async () => {
    const name = await deactivateUser(db, uuid.parse(id));
    await logActivity({ area: "Users", action: "deactivated", entityType: "user", entityId: id, summary: `Deactivated ${name} (signed out of all devices)` });
    return { name };
  });
}

export async function reactivateUserAction(id: string) {
  return run(async () => {
    const name = await reactivateUser(db, uuid.parse(id));
    await logActivity({ area: "Users", action: "reactivated", entityType: "user", entityId: id, summary: `Reactivated ${name}` });
    return { name };
  });
}

export async function signOutUserAction(id: string) {
  return run(async () => {
    const name = await signOutUserEverywhere(db, uuid.parse(id));
    await logActivity({ area: "Users", action: "signed out", entityType: "user", entityId: id, summary: `Signed ${name} out of all devices` });
    return { name };
  });
}

// ---- roles -----------------------------------------------------------------------------------------

const roleSchema = z.object({
  name: z.string().max(100),
  description: z.string().max(400),
  scopeOwnDepartments: z.boolean(),
  permissions: z.array(z.string().max(60)).max(200),
});

const label = (p: string) => (p in PERMISSIONS ? PERMISSIONS[p as keyof typeof PERMISSIONS].label : p);

export async function saveRoleAction(id: number | null, input: z.input<typeof roleSchema>) {
  return run(async () => {
    const v = roleSchema.parse(input);
    const r = await saveRole(db, id == null ? null : z.number().int().positive().parse(id), v);
    if (r.changes.length) {
      const words = r.changes.map((c) => c.replace(/^(added|removed) (.*)$/, (_, verb: string, list: string) => `${verb}: ${list.split(", ").map(label).join("; ")}`));
      await logActivity({ area: "Roles", action: id == null ? "created" : "changed", entityType: "role", entityId: String(r.id), summary: `${id == null ? "Created" : "Changed"} role ${v.name.trim()}${id == null ? "" : `: ${words.join(" · ")}`}` });
    }
    return { id: r.id };
  });
}

export async function copyRoleAction(id: number) {
  return run(async () => {
    const r = await copyRole(db, z.number().int().positive().parse(id));
    await logActivity({ area: "Roles", action: "created", entityType: "role", entityId: String(r.id), summary: `Copied a role as ${r.name}` });
    return r;
  });
}

export async function deleteRoleAction(id: number) {
  return run(async () => {
    const name = await deleteRole(db, z.number().int().positive().parse(id));
    await logActivity({ area: "Roles", action: "deleted", entityType: "role", entityId: String(id), summary: `Deleted role ${name}` });
    return { name };
  });
}

// ---- shared shop-floor devices and PINs (section 7) -----------------------------------------------

const deviceSchema = z.object({ name: z.string().trim().min(2, { message: "Please name this device, e.g. RPT shop floor tablet." }).max(60), deptCodes: z.array(z.string().max(10)).max(20) });

/** "Mark this device as a shared shop-floor device": from the Admin's profile, on that device. */
export async function markThisDeviceSharedAction(input: z.input<typeof deviceSchema>) {
  return run(async () => {
    const v = deviceSchema.parse(input);
    const g = await allow("users.manage");
    const token = newDeviceToken();
    const [d] = await db.insert(sharedDevices).values({ name: v.name, deptCodes: [...new Set(v.deptCodes)], tokenHash: hashToken(token), createdBy: g.ok ? g.me.id : null }).returning();
    await setDeviceCookie(token);
    await logActivity({ area: "Users", action: "shared device", summary: `Marked a device as shared: ${v.name}${v.deptCodes.length ? ` (${v.deptCodes.join(", ")})` : " (all departments)"}`, entityType: "shared_device", entityId: d.id });
    return { id: d.id };
  });
}

/** "Stop sharing this device": the token is revoked and the cookie removed. */
export async function stopSharingThisDeviceAction() {
  return run(async () => {
    const d = await findDevice(db, (await cookies()).get(DEVICE_COOKIE)?.value);
    if (d) {
      await db.update(sharedDevices).set({ revokedAt: new Date() }).where(eq(sharedDevices.id, d.id));
      await logActivity({ area: "Users", action: "shared device", summary: `Stopped sharing device ${d.name}`, entityType: "shared_device", entityId: d.id });
    }
    await clearDeviceCookie();
    return { ok: true };
  });
}

/** From the Users page: stop a shared device anywhere (e.g. a lost tablet). Its PIN sessions end at once. */
export async function revokeDeviceAction(id: string) {
  return run(async () => {
    const [d] = await db.update(sharedDevices).set({ revokedAt: new Date() }).where(and(eq(sharedDevices.id, uuid.parse(id)), isNull(sharedDevices.revokedAt))).returning();
    if (!d) throw new UserFacingError("This device was already stopped.");
    await logActivity({ area: "Users", action: "shared device", summary: `Stopped shared device ${d.name}`, entityType: "shared_device", entityId: d.id });
    return { name: d.name };
  });
}

/** Admin sets someone's shop-floor PIN (also for name-only people, e.g. contract operators). */
export async function setUserPinAction(id: string, pin: string) {
  return run(async () => {
    const problem = pinProblem(String(pin));
    if (problem) throw new UserFacingError(problem);
    const ctx = await auth.$context;
    const [u] = await db.update(appUsers).set({ pinHash: await ctx.password.hash(String(pin)), updatedAt: new Date() }).where(eq(appUsers.id, uuid.parse(id))).returning({ name: appUsers.fullName });
    if (!u) throw new UserFacingError("This person could not be found. Please refresh the page.");
    await logActivity({ area: "Users", action: "pin", summary: `Set the shop-floor PIN of ${u.name}`, entityType: "user", entityId: id });
    return { name: u.name };
  });
}

export async function clearUserPinAction(id: string) {
  return run(async () => {
    const [u] = await db.update(appUsers).set({ pinHash: null, updatedAt: new Date() }).where(eq(appUsers.id, uuid.parse(id))).returning({ name: appUsers.fullName });
    if (!u) throw new UserFacingError("This person could not be found. Please refresh the page.");
    await logActivity({ area: "Users", action: "pin", summary: `Removed the shop-floor PIN of ${u.name}`, entityType: "user", entityId: id });
    return { name: u.name };
  });
}
