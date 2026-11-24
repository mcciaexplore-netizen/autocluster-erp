/**
 * Admin pages on the server (Module 7, Phase 3):
 * - there is always at least one active Admin;
 * - a temporary password works once and must be changed (a reset does the same and signs them out);
 * - deactivating someone ends their sessions at once and refuses their old session;
 * - a role change applies on their next click, without signing in again;
 * - picker lists follow roles, and "Done by" is the signed-in person unless a Manager / Admin picks someone.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ensureDefaultRoles, saveRole } from "@/db/role-writer";
import * as s from "@/db/schema";
import { deactivateUser, reactivateUser, resetUserPassword, saveUser, signOutUserEverywhere, type UserFormInput } from "@/db/user-writer";
import { readAccess } from "@/lib/auth/access";
import { createAuth } from "@/lib/auth/better-auth";
import { can } from "@/lib/auth/can";
import type { CurrentUser } from "@/lib/auth/current-user";
import { mayRecordForOthers } from "@/lib/auth/done-by-rule";
import { loadDemoData, wipe } from "@/scripts/demo-data";
import { testDb } from "./helpers";

const skip = !!process.env.SKIP_DB_TESTS;
const { db, pool } = testDb();

let current: CurrentUser | null = null;
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => current }));
vi.mock("@/db", () => ({ db }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const auth = createAuth(db);
let n = 0;
const temp = () => `test temporary password ${++n}`;
const base: Omit<UserFormInput, "name" | "email" | "roleIds"> = { canSignIn: true, mobile: null, allDepartments: true, deptCodes: [] };

async function signIn(email: string, password: string) {
  return auth.api.signInEmail({ body: { email, password } });
}
async function sessions(appUserId: string) {
  const [u] = await db.select().from(s.appUsers).where(eq(s.appUsers.id, appUserId));
  return u.authUserId ? (await db.select().from(s.authSessions).where(eq(s.authSessions.userId, u.authUserId))).length : 0;
}
async function asPerson(appUserId: string): Promise<CurrentUser> {
  const [u] = await db.select().from(s.appUsers).where(eq(s.appUsers.id, appUserId));
  const a = (await readAccess(db, u.authUserId!))!;
  return { id: u.id, authUserId: u.authUserId!, sessionId: "t", name: u.fullName, email: u.email!, mobile: null, teamMemberId: u.teamMemberId, mustChangePassword: false, isDemo: false, allDepartments: u.allDepartments, departments: a.departments, roles: a.roles, grants: a.grants };
}

describe.skipIf(skip)("Users and Roles admin (database)", () => {
  let roles: Record<string, number>;
  beforeAll(async () => {
    await db.transaction(async (tx) => {
      await wipe(tx);
      await loadDemoData(tx, { quiet: true, crm: true });
    });
    roles = await ensureDefaultRoles(db);
  }, 120_000);
  afterAll(() => pool.end());

  let adminA = "";
  let adminB = "";

  it("there must always be one active Admin", async () => {
    const a = await saveUser(db, auth, null, { ...base, name: "Asha Admin", email: "asha@example.com", roleIds: [roles.Admin] }, temp);
    adminA = a.id;
    await expect(deactivateUser(db, adminA)).rejects.toThrow(/at least one active Admin/);
    await expect(saveUser(db, auth, adminA, { ...base, name: "Asha Admin", email: "asha@example.com", roleIds: [roles.Manager] }, temp)).rejects.toThrow(/at least one active Admin/);
    await expect(saveUser(db, auth, adminA, { ...base, canSignIn: false, name: "Asha Admin", email: "asha@example.com", roleIds: [roles.Admin] }, temp)).rejects.toThrow(/at least one active Admin/);
    // With a second Admin, the first can step down.
    adminB = (await saveUser(db, auth, null, { ...base, name: "Bala Admin", email: "bala@example.com", roleIds: [roles.Admin] }, temp)).id;
    await deactivateUser(db, adminA);
    await expect(deactivateUser(db, adminB)).rejects.toThrow(/at least one active Admin/);
    await reactivateUser(db, adminA);
  });

  it("the Admin role keeps user management, can't be renamed or deleted", async () => {
    const [r] = await db.select().from(s.roles).where(eq(s.roles.id, roles.Admin));
    await expect(saveRole(db, r.id, { name: "Boss", description: "", scopeOwnDepartments: false, permissions: ["users.manage", "settings.edit"] })).rejects.toThrow(/can't be renamed/);
    await expect(saveRole(db, r.id, { name: "Admin", description: "", scopeOwnDepartments: false, permissions: ["settings.edit"] })).rejects.toThrow(/always keeps/);
  });

  it("a new person gets a temporary password once, and must change it", async () => {
    const r = await saveUser(db, auth, null, { ...base, name: "Kiran Store", email: "Kiran@Example.com", roleIds: [roles.Store] }, temp);
    expect(r.created).toBe(true);
    expect(r.tempPassword).toMatch(/^test temporary password/);
    const [u] = await db.select().from(s.appUsers).where(eq(s.appUsers.id, r.id));
    expect(u).toMatchObject({ email: "kiran@example.com", canSignIn: true, mustChangePassword: true });
    expect(JSON.stringify(await db.select().from(s.authAccounts))).not.toContain(r.tempPassword!);
    expect((await signIn("kiran@example.com", r.tempPassword!)).token).toBeTruthy();
    // Saving again without changing sign-in makes no new password.
    const again = await saveUser(db, auth, r.id, { ...base, name: "Kiran Store", email: "kiran@example.com", roleIds: [roles.Store] }, temp);
    expect(again.tempPassword).toBeNull();
    expect(again.changes).toEqual([]);
  });

  it("a reset gives a new temporary password, signs them out and asks them to change it", async () => {
    const [u] = await db.select().from(s.appUsers).where(eq(s.appUsers.email, "kiran@example.com"));
    await db.update(s.appUsers).set({ mustChangePassword: false }).where(eq(s.appUsers.id, u.id));
    expect(await sessions(u.id)).toBeGreaterThan(0);
    const r = await resetUserPassword(db, auth, u.id, temp);
    expect(await sessions(u.id)).toBe(0);
    const [after] = await db.select().from(s.appUsers).where(eq(s.appUsers.id, u.id));
    expect(after.mustChangePassword).toBe(true);
    await expect(signIn("kiran@example.com", "test temporary password 3")).rejects.toThrow();
    expect((await signIn("kiran@example.com", r.tempPassword)).token).toBeTruthy();
  });

  it("deactivating someone ends their sessions now and refuses the account", async () => {
    const [u] = await db.select().from(s.appUsers).where(eq(s.appUsers.email, "kiran@example.com"));
    expect(await sessions(u.id)).toBeGreaterThan(0);
    expect(await readAccess(db, u.authUserId!)).not.toBeNull();
    await deactivateUser(db, u.id);
    expect(await sessions(u.id)).toBe(0);
    expect(await readAccess(db, u.authUserId!)).toBeNull();
    const [tm] = await db.select().from(s.teamMembers).where(eq(s.teamMembers.id, u.teamMemberId));
    expect(tm.isActive).toBe(false);
    await reactivateUser(db, u.id);
    expect(await readAccess(db, u.authUserId!)).not.toBeNull();
    // "Sign out of all devices"
    await signIn("kiran@example.com", (await resetUserPassword(db, auth, u.id, temp)).tempPassword);
    expect(await sessions(u.id)).toBeGreaterThan(0);
    await signOutUserEverywhere(db, u.id);
    expect(await sessions(u.id)).toBe(0);
  });

  it("switching someone to name only refuses their account at once", async () => {
    const r = await saveUser(db, auth, null, { ...base, name: "Nita Sales", email: "nita@example.com", roleIds: [roles.Sales] }, temp);
    await signIn("nita@example.com", r.tempPassword!);
    const [u] = await db.select().from(s.appUsers).where(eq(s.appUsers.id, r.id));
    await saveUser(db, auth, r.id, { ...base, canSignIn: false, name: "Nita Sales", email: "nita@example.com", roleIds: [roles.Sales] }, temp);
    expect(await sessions(r.id)).toBe(0);
    expect(await readAccess(db, u.authUserId!)).toBeNull();
  });

  it("a role change applies on their next click, without signing in again", async () => {
    const custom = await saveRole(db, null, { name: "Front desk", description: "", scopeOwnDepartments: false, permissions: ["crm.view"] });
    const r = await saveUser(db, auth, null, { ...base, name: "Farah Desk", email: "farah@example.com", roleIds: [custom.id] }, temp);
    const [u] = await db.select().from(s.appUsers).where(eq(s.appUsers.id, r.id));
    expect(can(await readAccess(db, u.authUserId!), "crm.edit")).toBe(false);
    const changed = await saveRole(db, custom.id, { name: "Front desk", description: "", scopeOwnDepartments: false, permissions: ["crm.view", "crm.edit"] });
    expect(changed.changes).toEqual(["added crm.edit"]);
    expect(can(await readAccess(db, u.authUserId!), "crm.edit")).toBe(true);
  });

  it("a role in use can't be deleted; an unused one can", async () => {
    const { deleteRole, copyRole } = await import("@/db/role-writer");
    await expect(deleteRole(db, roles.Store)).rejects.toThrow(/has this role/);
    const copy = await copyRole(db, roles.Store);
    expect(copy.name).toBe("Store (copy)");
    expect(await deleteRole(db, copy.id)).toBe("Store (copy)");
    await expect(deleteRole(db, roles.Admin)).rejects.toThrow(/can't be deleted/);
  });

  it("picker lists follow roles and departments (name-only people included)", async () => {
    const { peopleWith } = await import("@/lib/people");
    const op = await saveUser(db, auth, null, { ...base, canSignIn: false, email: null, name: "Omkar Operator", roleIds: [roles.Operator], allDepartments: false, deptCodes: ["RPT"] }, temp);
    const operators = await peopleWith("planning.operate");
    const [omkar] = await db.select().from(s.appUsers).where(eq(s.appUsers.id, op.id));
    expect(operators.find((p) => p.id === omkar.teamMemberId)).toMatchObject({ name: "Omkar Operator", depts: ["RPT"] });
    const [bala] = await db.select().from(s.appUsers).where(eq(s.appUsers.id, adminB));
    expect(operators.find((p) => p.id === bala.teamMemberId)?.depts).toBeNull(); // Admin: all departments
    const editors = await peopleWith("crm.edit");
    expect(editors.some((p) => p.id === omkar.teamMemberId)).toBe(false);
    expect(editors.some((p) => p.name === "Farah Desk")).toBe(true);
    expect(editors.some((p) => p.name === "Nita Sales")).toBe(true); // name only now, still has Sales
  });

  it("Done by is the signed-in person; only Managers and Admins record for someone else", async () => {
    const { doneByFor, logOnBehalf } = await import("@/lib/auth/done-by");
    const [omkar] = await db.select().from(s.appUsers).where(eq(s.appUsers.fullName, "Omkar Operator"));
    const kiran = await asPerson((await db.select().from(s.appUsers).where(eq(s.appUsers.email, "kiran@example.com")))[0].id);
    expect(mayRecordForOthers(kiran)).toBe(false);
    current = kiran;
    expect(await doneByFor(omkar.teamMemberId)).toEqual({ id: kiran.teamMemberId, onBehalfOf: null });
    expect(await doneByFor(null)).toEqual({ id: kiran.teamMemberId, onBehalfOf: null });

    const bala = await asPerson(adminB);
    expect(mayRecordForOthers(bala)).toBe(true);
    current = bala;
    const d = await doneByFor(omkar.teamMemberId);
    expect(d).toEqual({ id: omkar.teamMemberId, onBehalfOf: { userId: omkar.id, name: "Omkar Operator" } });
    await logOnBehalf(d, "Inventory", "used stock");
    const [log] = await db.select().from(s.activityLog).where(eq(s.activityLog.onBehalfOfUserId, omkar.id));
    expect(log.summary).toBe("Recorded by Bala Admin for Omkar Operator: used stock");
    current = null;
  });
});
