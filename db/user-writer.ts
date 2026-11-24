/**
 * People (Module 7). Each app user is linked 1:1 to a team member, so every existing
 * assigned_to / done_by / operator_id keeps working. Passwords are only ever handed to Better
 * Auth, which stores them hashed.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Auth } from "../lib/auth/better-auth";
import type { DB, Tx } from "./client";
import { UserFacingError } from "./quote-writer";
import { appUsers, authUsers, teamMembers } from "./schema";

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
