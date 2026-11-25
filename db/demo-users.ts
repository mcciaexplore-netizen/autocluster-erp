/**
 * Demo users (section 10), for db:reset and db:seed in demo mode only. Run after the demo data has
 * saved. Passwords are random, never shown and stored only as hashes: "Try it as..." signs in
 * without them. Demo operators get the demo PIN for the shop-floor tablet.
 */
import { randomBytes } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { isDemoMode, NOT_DEMO_MESSAGE } from "../lib/auth/demo-mode";
import type { Auth } from "../lib/auth/better-auth";
import type { DB } from "./client";
import { ensureDefaultRoles, setUserRoles } from "./role-writer";
import { activityLog, appUsers, crmActivities, invDocuments, jobs, leadEvents, leads, teamMembers, tickets, userDepartments } from "./schema";
import { createSignInUser, ensureAppUsersForTeam } from "./user-writer";

/** Shown on the demo shop-floor screen only (DEMO_MODE=true). */
export const DEMO_PIN = "2580";
export const DEMO_EMAIL_DOMAIN = "demo.acdri.example";

export interface DemoUser {
  name: string;
  roles: string[];
  depts: string[] | "all";
  /** The role it stands for on "Try it as..." */
  tryAs?: string;
  nameOnly?: boolean;
}

export const DEMO_USERS: DemoUser[] = [
  { name: "Demo Admin", roles: ["Admin"], depts: "all", tryAs: "Admin" },
  { name: "Sunita Joshi", roles: ["Manager"], depts: "all", tryAs: "Manager" },
  { name: "Neha Kulkarni", roles: ["Sales"], depts: "all", tryAs: "Sales" },
  { name: "Vikram Shah", roles: ["Accounts"], depts: "all", tryAs: "Accounts" },
  { name: "Meera Iyer", roles: ["Planner", "Store"], depts: ["RPT", "PPF", "MET"], tryAs: "Planner" },
  { name: "Amit Patil", roles: ["Operator"], depts: ["PPF", "MET"] },
  { name: "Rohan Deshpande", roles: ["Operator"], depts: ["RPT"], tryAs: "Operator" },
  { name: "Priya Shah", roles: ["Operator"], depts: ["ENV", "RPL"] },
  { name: "Sanjay More", roles: ["Store"], depts: "all", tryAs: "Store" },
  { name: "Board Member", roles: ["Viewer"], depts: "all", tryAs: "Viewer" },
  { name: "Ravi Contract", roles: ["Operator"], depts: ["PPF"], nameOnly: true },
];

export const TRY_AS_ROLES = DEMO_USERS.filter((u) => u.tryAs).map((u) => ({ role: u.tryAs!, name: u.name }));
export const demoEmail = (name: string) => `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@${DEMO_EMAIL_DOMAIN}`;
const OPERATORS_BEFORE = ["Amit Patil", "Rohan Deshpande", "Priya Shah"];

/** Adds the demo users. `hashPin` stores the demo PIN as a hash, like any PIN. */
export async function setUpDemoUsers(db: DB, auth: Auth, opts: { now?: Date; log?: (m: string) => void } = {}) {
  if (!isDemoMode()) throw new Error(NOT_DEMO_MESSAGE);
  const log = opts.log ?? (() => {});
  const now = opts.now ?? new Date();
  await ensureAppUsersForTeam(db);
  const roles = await ensureDefaultRoles(db);
  const ctx = await auth.$context;
  const pinHash = await ctx.password.hash(DEMO_PIN);
  const ids: Record<string, { id: string; teamMemberId: string }> = {};

  for (const u of DEMO_USERS) {
    const [tm] = await db.select({ id: teamMembers.id }).from(teamMembers).where(sql`lower(${teamMembers.name}) = lower(${u.name})`);
    let made: { id: string; teamMemberId: string };
    if (u.nameOnly) {
      const teamMemberId = tm?.id ?? (await db.insert(teamMembers).values({ name: u.name, sortOrder: 100 }).returning())[0].id;
      await ensureAppUsersForTeam(db);
      const [au] = await db.select({ id: appUsers.id }).from(appUsers).where(eq(appUsers.teamMemberId, teamMemberId));
      await db.update(appUsers).set({ isDemo: true, canSignIn: false }).where(eq(appUsers.id, au.id));
      made = { id: au.id, teamMemberId };
    } else {
      // Keeps the existing team member (and so Amit's, Rohan's and Priya's job and booking links).
      made = await createSignInUser(db, auth, { name: u.name, email: demoEmail(u.name), password: randomBytes(24).toString("base64url"), teamMemberId: tm?.id, isDemo: true });
    }
    ids[u.name] = made;
    await db.update(appUsers).set({ allDepartments: u.depts === "all", pinHash: u.roles.includes("Operator") ? pinHash : null }).where(eq(appUsers.id, made.id));
    await db.delete(userDepartments).where(eq(userDepartments.userId, made.id));
    if (u.depts !== "all") await db.insert(userDepartments).values(u.depts.map((deptCode) => ({ userId: made.id, deptCode })));
    await setUserRoles(db, made.id, u.roles.map((r) => roles[r]));
  }
  log(`Added ${DEMO_USERS.length} demo users (one for each role).`);

  // Operators don't sell: their enquiries and open CRM activities move to Neha, with a history line.
  const neha = ids["Neha Kulkarni"];
  const from = OPERATORS_BEFORE.map((n) => ids[n]?.teamMemberId).filter(Boolean);
  const moved = await db
    .select({ id: leads.id, was: teamMembers.name })
    .from(leads)
    .innerJoin(teamMembers, eq(teamMembers.id, leads.assignedTo))
    .where(and(inArray(leads.assignedTo, from), isNull(leads.deletedAt)));
  if (moved.length) {
    await db.update(leads).set({ assignedTo: neha.teamMemberId }).where(inArray(leads.id, moved.map((m) => m.id)));
    await db.insert(leadEvents).values(moved.map((m) => ({ leadId: m.id, type: "ASSIGNED", message: `Assigned to Neha Kulkarni (was ${m.was})`, createdBy: "Demo User" })));
  }
  await db.update(crmActivities).set({ assignedTo: neha.teamMemberId }).where(and(inArray(crmActivities.assignedTo, from), isNull(crmActivities.doneAt)));
  log(`Moved ${moved.length} enquiries from the operators to Neha Kulkarni.`);

  await addDemoActivity(db, ids, now);
  log("Added a few days of Activity log entries.");
  return ids;
}

/** A few days of realistic Activity log entries, pointing at real demo records. */
async function addDemoActivity(db: DB, ids: Record<string, { id: string }>, now: Date) {
  const pick = <T,>(rows: T[], i: number) => rows[i % Math.max(rows.length, 1)];
  const [someLeads, someTickets, someJobs, someDocs] = await Promise.all([
    db.select({ id: leads.id, no: leads.leadNo, title: leads.title }).from(leads).where(isNull(leads.deletedAt)).limit(6),
    db.select({ id: tickets.id, no: tickets.ticketNo }).from(tickets).limit(6),
    db.select({ id: jobs.id, no: tickets.ticketNo }).from(jobs).innerJoin(tickets, eq(tickets.id, jobs.ticketId)).limit(6),
    db.select({ id: invDocuments.id, no: invDocuments.docNo, type: invDocuments.type }).from(invDocuments).limit(6),
  ]);
  const at = (daysAgo: number, hh: number, mm = 0) => {
    const d = new Date(now.getTime() - daysAgo * 86_400_000);
    // India time hh:mm on that day
    const ist = new Date(d.getTime() + 5.5 * 3_600_000);
    ist.setUTCHours(hh, mm, 0, 0);
    return new Date(ist.getTime() - 5.5 * 3_600_000);
  };
  const ip = (n: number) => `103.21.58.${10 + n}`;
  const u = (name: string) => ids[name]?.id ?? null;
  const rows: (typeof activityLog.$inferInsert)[] = [];
  for (let day = 4; day >= 1; day--) {
    const k = 4 - day;
    rows.push(
      { userId: u("Neha Kulkarni"), area: "Sign-in", action: "signed in", summary: "Signed in", entityType: "user", entityId: u("Neha Kulkarni"), ip: ip(1), createdAt: at(day, 9, 12) },
      { userId: u("Rohan Deshpande"), area: "Sign-in", action: "signed in", summary: `Signed in with PIN on shared device "RPT shop floor tablet"`, entityType: "user", entityId: u("Rohan Deshpande"), ip: ip(2), createdAt: at(day, 9, 30) },
    );
    const lead = pick(someLeads, k);
    if (lead) rows.push({ userId: u("Neha Kulkarni"), area: "CRM", action: "note", summary: `Called the customer about "${lead.title}"`, entityType: "lead", entityId: lead.id, createdAt: at(day, 10, 5) });
    const job = pick(someJobs, k);
    if (job) {
      rows.push({ userId: u("Rohan Deshpande"), area: "Planning", action: "started", summary: `Started job ${job.no}`, entityType: "job", entityId: job.id, createdAt: at(day, 9, 41) });
      rows.push({ userId: u("Rohan Deshpande"), area: "Planning", action: "paused", summary: `Paused job ${job.no} (Lunch break)`, entityType: "job", entityId: job.id, createdAt: at(day, 13, 2) });
    }
    const t = pick(someTickets, k);
    if (t) rows.push({ userId: u("Vikram Shah"), area: "Orders", action: "payment", summary: `Payment recorded on ${t.no}`, entityType: "ticket", entityId: t.id, createdAt: at(day, 15, 20) });
    const doc = pick(someDocs, k);
    if (doc) rows.push({ userId: u("Sanjay More"), area: "Inventory", action: doc.type.toLowerCase(), summary: `${doc.type === "IN" ? "Stock received" : doc.type === "OUT" ? "Stock used" : "Stock adjusted"}: ${doc.no}`, entityType: "inv_document", entityId: doc.id, createdAt: at(day, 16, 45) });
  }
  rows.push(
    { userId: null, area: "Sign-in", action: "failed sign-in", summary: `Failed sign-in for vikram.shah@${DEMO_EMAIL_DOMAIN}: wrong password`, entityType: "user", entityId: u("Vikram Shah"), ip: ip(9), createdAt: at(2, 8, 58) },
    { userId: u("Demo Admin"), area: "Roles", action: "changed", summary: "Changed role Store: added: Send orders to suppliers", entityType: "role", entityId: null, createdAt: at(3, 11, 15) },
    { userId: u("Demo Admin"), area: "Users", action: "created", summary: "Added Ravi Contract (name only)", entityType: "user", entityId: u("Ravi Contract"), createdAt: at(3, 11, 30) },
    { userId: u("Sunita Joshi"), onBehalfOfUserId: u("Amit Patil"), area: "Planning", action: "on behalf", summary: "Recorded by Sunita Joshi for Amit Patil: finished a job", entityType: "job", entityId: pick(someJobs, 5)?.id ?? null, createdAt: at(1, 17, 40) },
  );
  await db.insert(activityLog).values(rows);
}
