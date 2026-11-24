/**
 * People (Module 7). Each app user is linked 1:1 to a team member, so every existing
 * assigned_to / done_by / operator_id keeps working. Passwords are only ever handed to Better
 * Auth, which stores them hashed.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Auth } from "../lib/auth/better-auth";
import type { DB, Tx } from "./client";
import { UserFacingError } from "./quote-writer";
import { setUserRoles } from "./role-writer";
import { appUsers, authSessions, authUsers, roles, teamMembers, userDepartments, userRoles } from "./schema";

const normEmail = (e: string | null | undefined) => e?.trim().toLowerCase() || null;

/** Every team member without a user gets one, as "name only" (they can't sign in until an admin says so). */
export async function ensureAppUsersForTeam(db: DB | Tx): Promise<number> {
  const missing = await db
    .select({ id: teamMembers.id, name: teamMembers.name, email: teamMembers.email, phone: teamMembers.phone })
    .from(teamMembers)
    .leftJoin(appUsers, eq(appUsers.teamMemberId, teamMembers.id))
    .where(isNull(appUsers.id));
  for (const m of missing) {
    const email = normEmail(m.email);
    // An email can belong to one user only; leave it off if someone else already has it.
    const taken = email ? (await db.select({ id: appUsers.id }).from(appUsers).where(eq(appUsers.email, email))).length > 0 : false;
    await db.insert(appUsers).values({ teamMemberId: m.id, fullName: m.name, email: taken ? null : email, mobile: m.phone, canSignIn: false });
  }
  return missing.length;
}

export interface SignInUserInput {
  name: string;
  email: string;
  password: string;
  mobile?: string | null;
  mustChangePassword?: boolean;
  isDemo?: boolean;
  /** Link to an existing team member (keeps their history); otherwise one is made. */
  teamMemberId?: string;
}

/**
 * A person who can sign in: Better Auth account (hashed password) + app user + team member.
 * Used by `users:create-admin`, the Users page and the demo data.
 */
export async function createSignInUser(db: DB | Tx, auth: Auth, input: SignInUserInput): Promise<{ id: string; teamMemberId: string }> {
  const name = input.name.trim().replace(/\s+/g, " ");
  const email = normEmail(input.email);
  if (name.length < 2) throw new UserFacingError("Please enter the full name.");
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new UserFacingError("This email address doesn't look right, e.g. name@company.com.");
  const [clash] = await db.select({ id: appUsers.id, teamMemberId: appUsers.teamMemberId }).from(appUsers).where(eq(appUsers.email, email));
  if (clash && clash.teamMemberId !== input.teamMemberId) throw new UserFacingError("Someone already uses this email address.");
  if ((await db.select({ id: authUsers.id }).from(authUsers).where(eq(authUsers.email, email))).length) throw new UserFacingError("Someone already uses this email address.");

  let teamMemberId = input.teamMemberId;
  if (!teamMemberId) {
    const [same] = await db.select({ id: teamMembers.id }).from(teamMembers).where(sql`lower(${teamMembers.name}) = lower(${name})`);
    const linked = same ? (await db.select({ id: appUsers.id, auth: appUsers.authUserId }).from(appUsers).where(eq(appUsers.teamMemberId, same.id)))[0] : undefined;
    if (same && !linked?.auth) teamMemberId = same.id;
    else {
      const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${teamMembers.sortOrder}), 0)` }).from(teamMembers);
      teamMemberId = (await db.insert(teamMembers).values({ name, email, phone: input.mobile ?? null, sortOrder: Number(max) + 1 }).returning())[0].id;
    }
  }

  const created = await auth.api.createUser({ body: { email, password: input.password, name } });
  const values = {
    authUserId: created.user.id,
    fullName: name,
    email,
    mobile: input.mobile ?? null,
    canSignIn: true,
    mustChangePassword: input.mustChangePassword ?? false,
    isDemo: input.isDemo ?? false,
    updatedAt: new Date(),
  };
  const [existing] = await db.select({ id: appUsers.id }).from(appUsers).where(eq(appUsers.teamMemberId, teamMemberId));
  const id = existing
    ? (await db.update(appUsers).set(values).where(and(eq(appUsers.id, existing.id))).returning())[0].id
    : (await db.insert(appUsers).values({ ...values, teamMemberId }).returning())[0].id;
  await db.update(teamMembers).set({ name, email, ...(input.mobile ? { phone: input.mobile } : {}) }).where(eq(teamMembers.id, teamMemberId));
  return { id, teamMemberId };
}

// ---- Admin: users (section 5.2) -------------------------------------------------------------------

const MOBILE_RE = /^[6-9]\d{9}$/;

/** Is this person an active Admin who can sign in? */
async function activeAdminIds(db: DB | Tx): Promise<string[]> {
  const rows = await db.execute<{ id: string }>(sql`
    select u.id from app_users u join user_roles ur on ur.user_id = u.id join roles r on r.id = ur.role_id
    where r.name = 'Admin' and u.can_sign_in and u.deactivated_at is null and u.auth_user_id is not null`);
  return rows.rows.map((r) => r.id);
}

/** Refuses a change that would leave nobody who can manage users. */
export async function assertAdminRemains(db: DB | Tx, change: { userId: string; stillAdmin: boolean }) {
  if (change.stillAdmin) return;
  const ids = await activeAdminIds(db);
  if (ids.length === 1 && ids[0] === change.userId) {
    throw new UserFacingError("There must always be at least one active Admin. Make someone else an Admin first.");
  }
}

export interface UserFormInput {
  name: string;
  canSignIn: boolean;
  email: string | null;
  mobile: string | null;
  roleIds: number[];
  allDepartments: boolean;
  deptCodes: string[];
}

function cleanInput(v: UserFormInput) {
  const name = v.name.trim().replace(/\s+/g, " ");
  if (name.length < 2) throw new UserFacingError("Please enter the full name.");
  if (name.length > 80) throw new UserFacingError("Keep the name under 80 characters.");
  const email = normEmail(v.email);
  if (v.canSignIn && !email) throw new UserFacingError("Please enter their email: it's what they sign in with.");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new UserFacingError("This email address doesn't look right, e.g. name@company.com.");
  const mobile = (v.mobile ?? "").replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "") || null;
  if (mobile && !MOBILE_RE.test(mobile)) throw new UserFacingError("Enter a 10-digit mobile number, e.g. 98220 12345.");
  if (v.canSignIn && !v.roleIds.length) throw new UserFacingError("Please choose at least one role.");
  if (!v.allDepartments && !v.deptCodes.length) throw new UserFacingError("Please choose their departments, or All departments.");
  return { name, email, mobile };
}

async function setDepartments(db: DB | Tx, userId: string, all: boolean, codes: string[]) {
  await db.delete(userDepartments).where(eq(userDepartments.userId, userId));
  if (!all && codes.length) await db.insert(userDepartments).values([...new Set(codes)].map((deptCode) => ({ userId, deptCode })));
}

/**
 * Add or change a person. Returns a temporary password when one was made (a new sign-in, or a
 * name-only person switched to sign-in): shown once, never stored in plain text.
 */
export async function saveUser(db: DB, auth: Auth, id: string | null, v: UserFormInput, makeTempPassword: () => string): Promise<{ id: string; tempPassword: string | null; created: boolean; changes: string[] }> {
  const { name, email, mobile } = cleanInput(v);
  if (email) {
    const [clash] = await db.select({ id: appUsers.id }).from(appUsers).where(eq(appUsers.email, email));
    if (clash && clash.id !== id) throw new UserFacingError("Someone already uses this email address.");
  }
  const allRoles = await db.select().from(roles);
  const adminRole = allRoles.find((r) => r.name === "Admin");
  const roleIds = v.roleIds.filter((r) => allRoles.some((x) => x.id === r));
  const changes: string[] = [];

  if (!id) {
    const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${teamMembers.sortOrder}), 0)` }).from(teamMembers);
    const [tm] = await db.insert(teamMembers).values({ name, email, phone: mobile, sortOrder: Number(max) + 1 }).returning();
    let authUserId: string | null = null;
    let tempPassword: string | null = null;
    if (v.canSignIn) {
      tempPassword = makeTempPassword();
      authUserId = (await auth.api.createUser({ body: { email: email!, password: tempPassword, name } })).user.id;
    }
    const [u] = await db
      .insert(appUsers)
      .values({ teamMemberId: tm.id, authUserId, fullName: name, email, mobile, canSignIn: v.canSignIn, mustChangePassword: v.canSignIn, allDepartments: v.allDepartments })
      .returning();
    await setUserRoles(db, u.id, roleIds);
    await setDepartments(db, u.id, v.allDepartments, v.deptCodes);
    return { id: u.id, tempPassword, created: true, changes: ["created"] };
  }

  const [before] = await db.select().from(appUsers).where(eq(appUsers.id, id));
  if (!before) throw new UserFacingError("This person could not be found. Please refresh the page.");
  const beforeRoles = (await db.select({ roleId: userRoles.roleId }).from(userRoles).where(eq(userRoles.userId, id))).map((r) => r.roleId);
  await assertAdminRemains(db, { userId: id, stillAdmin: v.canSignIn && !before.deactivatedAt && !!adminRole && roleIds.includes(adminRole.id) });

  let authUserId = before.authUserId;
  let tempPassword: string | null = null;
  if (v.canSignIn && !authUserId) {
    // Name only -> can sign in: give them an account with a temporary password.
    tempPassword = makeTempPassword();
    authUserId = (await auth.api.createUser({ body: { email: email!, password: tempPassword, name } })).user.id;
    changes.push("can now sign in");
  } else if (authUserId) {
    if (email && email !== before.email) {
      const [taken] = await db.select({ id: authUsers.id }).from(authUsers).where(eq(authUsers.email, email));
      if (taken && taken.id !== authUserId) throw new UserFacingError("Someone already uses this email address.");
      await db.update(authUsers).set({ email, updatedAt: new Date() }).where(eq(authUsers.id, authUserId));
      changes.push(`email ${email}`);
    }
    if (name !== before.fullName) await db.update(authUsers).set({ name, updatedAt: new Date() }).where(eq(authUsers.id, authUserId));
    if (!v.canSignIn && before.canSignIn) {
      // Switched to name only: they can't sign in any more, starting now.
      await db.delete(authSessions).where(eq(authSessions.userId, authUserId));
      changes.push("name only (can't sign in)");
    }
  }
  if (name !== before.fullName) changes.push(`name ${name}`);
  if ((mobile ?? null) !== (before.mobile ?? null)) changes.push("mobile");
  await db
    .update(appUsers)
    .set({ fullName: name, email, mobile, canSignIn: v.canSignIn, authUserId, mustChangePassword: tempPassword ? true : before.mustChangePassword, allDepartments: v.allDepartments, updatedAt: new Date() })
    .where(eq(appUsers.id, id));
  await db.update(teamMembers).set({ name, email, phone: mobile }).where(eq(teamMembers.id, before.teamMemberId));
  if ([...beforeRoles].sort().join() !== [...roleIds].sort().join()) {
    changes.push(`roles ${allRoles.filter((r) => roleIds.includes(r.id)).map((r) => r.name).join(", ") || "none"}`);
    await setUserRoles(db, id, roleIds);
  }
  await setDepartments(db, id, v.allDepartments, v.deptCodes);
  return { id, tempPassword, created: false, changes };
}

/** "Reset password": a new temporary password (shown once); they must change it at next sign-in. */
export async function resetUserPassword(db: DB, auth: Auth, id: string, makeTempPassword: () => string): Promise<{ name: string; tempPassword: string }> {
  const [u] = await db.select().from(appUsers).where(eq(appUsers.id, id));
  if (!u) throw new UserFacingError("This person could not be found. Please refresh the page.");
  if (!u.canSignIn || !u.authUserId) throw new UserFacingError("This person is name only. Switch on “Can sign in” first.");
  const tempPassword = makeTempPassword();
  const ctx = await auth.$context;
  const hash = await ctx.password.hash(tempPassword);
  const accounts = await ctx.internalAdapter.findAccounts(u.authUserId);
  if (accounts.some((a) => a.providerId === "credential")) await ctx.internalAdapter.updatePassword(u.authUserId, hash);
  else await ctx.internalAdapter.linkAccount({ userId: u.authUserId, providerId: "credential", accountId: u.authUserId, password: hash });
  await db.delete(authSessions).where(eq(authSessions.userId, u.authUserId));
  await db.update(appUsers).set({ mustChangePassword: true, updatedAt: new Date() }).where(eq(appUsers.id, id));
  return { name: u.fullName, tempPassword };
}

/** Deactivate: they can't sign in, their sessions end at once, their history stays. */
export async function deactivateUser(db: DB, id: string) {
  const [u] = await db.select().from(appUsers).where(eq(appUsers.id, id));
  if (!u) throw new UserFacingError("This person could not be found. Please refresh the page.");
  await assertAdminRemains(db, { userId: id, stillAdmin: false });
  await db.update(appUsers).set({ deactivatedAt: new Date(), updatedAt: new Date() }).where(eq(appUsers.id, id));
  await db.update(teamMembers).set({ isActive: false }).where(eq(teamMembers.id, u.teamMemberId));
  if (u.authUserId) await db.delete(authSessions).where(eq(authSessions.userId, u.authUserId));
  return u.fullName;
}

export async function reactivateUser(db: DB, id: string) {
  const [u] = await db.update(appUsers).set({ deactivatedAt: null, updatedAt: new Date() }).where(eq(appUsers.id, id)).returning();
  if (!u) throw new UserFacingError("This person could not be found. Please refresh the page.");
  await db.update(teamMembers).set({ isActive: true }).where(eq(teamMembers.id, u.teamMemberId));
  return u.fullName;
}

/** "Sign out of all devices" for someone else. */
export async function signOutUserEverywhere(db: DB, id: string) {
  const [u] = await db.select().from(appUsers).where(eq(appUsers.id, id));
  if (!u) throw new UserFacingError("This person could not be found. Please refresh the page.");
  if (u.authUserId) await db.delete(authSessions).where(eq(authSessions.userId, u.authUserId));
  return u.fullName;
}
