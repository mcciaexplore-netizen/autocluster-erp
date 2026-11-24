import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addJobEvent } from "@/db/job-writer";
import { ensureDefaultRoles, setUserRoles } from "@/db/role-writer";
import * as s from "@/db/schema";
import { createSignInUser, ensureAppUsersForTeam } from "@/db/user-writer";
import { actorName } from "@/lib/auth/actor";
import { createAuth } from "@/lib/auth/better-auth";
import { DEFAULT_ROLES } from "@/lib/auth/permissions";
import { loadDemoData, wipe } from "@/scripts/demo-data";
import { testDb } from "./helpers";

const skip = !!process.env.SKIP_DB_TESTS;
const { db, pool } = testDb();

describe.skipIf(skip)("users and sign-in (database)", () => {
  beforeAll(async () => {
    await db.transaction(async (tx) => {
      await wipe(tx);
      await loadDemoData(tx, { quiet: true, crm: true });
    });
  }, 120_000);
  afterAll(() => pool.end());

  it("every team member is a user (name only), keeping the same team link", async () => {
    const team = await db.select().from(s.teamMembers);
    const users = await db.select().from(s.appUsers);
    expect(team.length).toBeGreaterThan(0);
    expect(users.map((u) => u.teamMemberId).sort()).toEqual(team.map((t) => t.id).sort());
    expect(users.every((u) => !u.canSignIn && !u.authUserId)).toBe(true);
    expect(await ensureAppUsersForTeam(db)).toBe(0); // running it again adds nothing
  });

  it("the default roles exist with their permissions", async () => {
    const ids = await ensureDefaultRoles(db);
    expect(Object.keys(ids).sort()).toEqual(DEFAULT_ROLES.map((r) => r.name).sort());
    const op = await db.select().from(s.rolePermissions).where(eq(s.rolePermissions.roleId, ids.Operator));
    expect(op.map((p) => p.permission).sort()).toEqual(["inventory.use_own_jobs", "planning.operate", "planning.view"]);
  });

  it("an existing team member can be given sign-in; the password is stored only as a hash", async () => {
    const [amit] = await db.select().from(s.teamMembers).where(eq(s.teamMembers.name, "Amit Patil"));
    const secret = "river lanterns 2026";
    const u = await createSignInUser(db, createAuth(db), { name: "Amit Patil", email: "Amit@Example.com", password: secret, teamMemberId: amit.id, mustChangePassword: true });
    expect(u.teamMemberId).toBe(amit.id);
    const [row] = await db.select().from(s.appUsers).where(eq(s.appUsers.id, u.id));
    expect(row).toMatchObject({ email: "amit@example.com", canSignIn: true, mustChangePassword: true });
    const [acc] = await db.select().from(s.authAccounts).where(eq(s.authAccounts.userId, row.authUserId!));
    expect(acc.password).toBeTruthy();
    expect(acc.password).not.toContain(secret);
    const roles = await ensureDefaultRoles(db);
    await setUserRoles(db, u.id, [roles.Operator, roles.Operator]);
    expect(await db.select().from(s.userRoles).where(eq(s.userRoles.userId, u.id))).toHaveLength(1);
    await expect(createSignInUser(db, createAuth(db), { name: "Someone Else", email: "amit@example.com", password: secret })).rejects.toThrow(/already uses this email/);
  });

  it("outside a signed-in request, records keep saying Demo User", async () => {
    expect(await actorName()).toBe("Demo User");
    const [job] = await db.select().from(s.jobs).limit(1);
    if (job) {
      await addJobEvent(db, job.id, "NOTE", "test");
      const [e] = await db.select().from(s.jobEvents).where(eq(s.jobEvents.jobId, job.id)).orderBy(s.jobEvents.id);
      expect(e.createdBy).toBe("Demo User");
    }
  });
});
