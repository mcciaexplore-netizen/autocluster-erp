/**
 * Permissions on the server, as different people:
 * - CRM money is a sale price: a custom role with CRM access but no prices never gets it.
 * - A Viewer can't open Settings, Users, Roles or the Activity log.
 * - Someone still on a temporary password can't open any page or run any action.
 */
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { eq, isNotNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as s from "@/db/schema";
import { buildGrants } from "@/lib/auth/can";
import type { CurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_ROLES } from "@/lib/auth/permissions";
import { loadDemoData, wipe } from "@/scripts/demo-data";
import { testDb } from "./helpers";

const skip = !!process.env.SKIP_DB_TESTS;
const { db, pool } = testDb();

// The signed-in person for each call (set by each test).
let current: CurrentUser | null = null;
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => current }));
vi.mock("@/db", () => ({ db }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

function person(name: string, perms: { roles?: string[]; custom?: string[] }, mustChangePassword = false): CurrentUser {
  const roles = (perms.roles ?? []).map((r) => DEFAULT_ROLES.find((x) => x.name === r)!).map((r) => ({ scopeOwnDepartments: r.scopeOwnDepartments, permissions: r.permissions as string[] }));
  if (perms.custom) roles.push({ scopeOwnDepartments: false, permissions: perms.custom });
  return {
    id: "00000000-0000-4000-8000-000000000001",
    authUserId: "test",
    sessionId: "test",
    name,
    email: `${name.toLowerCase().replace(/\W+/g, ".")}@example.com`,
    mobile: null,
    teamMemberId: "00000000-0000-4000-8000-000000000002",
    mustChangePassword,
    isDemo: false,
    allDepartments: true,
    departments: [],
    roles: [],
    grants: buildGrants(roles, { allDepartments: true, departments: [] }),
  };
}

const crmClerk = person("CRM Clerk", { custom: ["crm.view", "crm.edit", "crm.import", "customers.view"] });
const sales = person("Neha Kulkarni", { roles: ["Sales"] });
const viewer = person("Board Member", { roles: ["Viewer"] });
const newAdmin = person("New Admin", { roles: ["Admin"] }, true);

/** next/navigation's redirect() throws an error whose digest names the target. */
const redirectTarget = (e: unknown) => /NEXT_REDIRECT;[^;]*;([^;]+);/.exec(String((e as { digest?: string })?.digest ?? ""))?.[1] ?? null;

describe.skipIf(skip)("permissions on the server (database)", () => {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  beforeAll(async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN; // never upload from tests
    await db.transaction(async (tx) => {
      await wipe(tx);
      await loadDemoData(tx, { quiet: true, orders: { blobFolder: "local" }, crm: true });
    });
  }, 120_000);
  afterAll(async () => {
    if (token) process.env.BLOB_READ_WRITE_TOKEN = token;
    await pool.end();
  });

  describe("CRM money is a sale price", () => {
    it("the demo has expected values, and Sales sees them", async () => {
      const withValue = await db.select().from(s.leads).where(isNotNull(s.leads.expectedValue));
      expect(withValue.length).toBeGreaterThan(3);
      current = sales;
      const { getBoardLeads, getCrmHomeStats } = await import("@/lib/crm-data");
      expect((await getBoardLeads()).some((l) => l.expectedValuePaise != null)).toBe(true);
      expect((await getCrmHomeStats()).openValuePaise).toBeGreaterThan(0);
    });

    it("a role with CRM access but no prices gets no expected values, totals or card values", async () => {
      current = crmClerk;
      const { getBoardLeads, getCrmHomeStats, getLeadDetail, getCustomerLeads } = await import("@/lib/crm-data");
      const board = await getBoardLeads();
      expect(board.length).toBeGreaterThan(3);
      expect(board.every((l) => l.expectedValuePaise == null)).toBe(true);
      const stats = await getCrmHomeStats();
      expect(stats.openValuePaise).toBeNull();
      expect(stats.wonValuePaise).toBeNull();
      expect(stats.openCount).toBeGreaterThan(0); // counts are not prices
      // A won enquiry with a quotation: no quotation total and no rupees in its history.
      const [won] = await db.select({ id: s.leads.id, customerId: s.leads.customerId }).from(s.leads).innerJoin(s.quotations, eq(s.quotations.leadId, s.leads.id)).limit(1);
      const d = (await getLeadDetail(won.id))!;
      expect(d.lead.expectedValuePaise).toBeNull();
      expect(d.quotations.every((q) => q.totalPaise == null)).toBe(true);
      expect(d.events.some((e) => e.message.includes("₹"))).toBe(false);
      expect((await getCustomerLeads(won.customerId!)).every((l) => l.expectedValue == null)).toBe(true);
    });

    it("the CRM Excel download has no expected values for them", async () => {
      current = crmClerk;
      const { GET } = await import("@/app/api/crm/export/route");
      const res = await GET(new Request("http://localhost/api/crm/export"));
      expect(res.status).toBe(200);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ArrayBuffer);
      const ws = wb.worksheets[0];
      let col = 0;
      let headerRow = 0;
      ws.eachRow((row, n) => row.eachCell((c, i) => {
        if (!col && String(c.value).startsWith("Expected value")) [col, headerRow] = [i, n];
      }));
      expect(col).toBeGreaterThan(0);
      const values: unknown[] = [];
      ws.eachRow((row, n) => {
        if (n > headerRow) values.push(row.getCell(col).value);
      });
      expect(values.length).toBeGreaterThan(3);
      expect(values.every((v) => v == null || v === "")).toBe(true);
    });

    it("editing an enquiry keeps its value; quick add and import don't set one", async () => {
      current = crmClerk;
      const { getLeadDetail } = await import("@/lib/crm-data");
      const { updateLeadAction, quickAddLeadAction } = await import("@/lib/actions/crm");
      const { importLeadsAction } = await import("@/lib/actions/crm-import");
      const { formValuesFromDetail } = await import("@/components/crm/lead-panel");
      const [lead] = await db.select().from(s.leads).where(isNotNull(s.leads.expectedValue)).limit(1);
      const values = formValuesFromDetail((await getLeadDetail(lead.id))!);
      expect(values.expectedValue).toBe(""); // they never saw it
      const r = await updateLeadAction(lead.id, { ...values, title: `${values.title} (checked)` });
      expect(r.ok).toBe(true);
      const [after] = await db.select().from(s.leads).where(eq(s.leads.id, lead.id));
      expect(after.title.endsWith("(checked)")).toBe(true);
      expect(after.expectedValue).toBe(lead.expectedValue);

      const [stage] = await db.select().from(s.crmStages).orderBy(s.crmStages.sortOrder).limit(1);
      const [source] = await db.select().from(s.crmSources).limit(1);
      const q = await quickAddLeadAction({ stageId: stage.id, sourceId: source.id, title: "Clerk quick add", companyName: "Clerk Co", contactName: "A Person", mobileOrEmail: "9822012399", expectedValue: "75000" });
      expect(q.ok).toBe(true);
      const [qa] = await db.select().from(s.leads).where(eq(s.leads.title, "Clerk quick add"));
      expect(qa.expectedValue).toBeNull();

      const { IMPORT_COLUMNS } = await import("@/lib/crm/import");
      const raw = Object.fromEntries(IMPORT_COLUMNS.map((c) => [c.key, c.example])) as Record<string, string>;
      raw.title = "Clerk import";
      raw.stage = stage.name;
      raw.source = source.name;
      const imp = await importLeadsAction([{ rowNo: 2, raw }], "clerk.xlsx");
      expect(imp.ok).toBe(true);
      const [im] = await db.select().from(s.leads).where(eq(s.leads.title, "Clerk import"));
      expect(im.expectedValue).toBeNull();
    });
  });

  describe("Viewer and the admin pages", () => {
    it("a Viewer can't open Settings, Users, Roles or the Activity log", async () => {
      current = viewer;
      const { settingsAccess, adminAccess } = await import("@/lib/admin-data");
      const forbidden = { digest: "NEXT_HTTP_ERROR_FALLBACK;403" }; // Next's forbidden(): the friendly no-access page
      await expect(settingsAccess()).rejects.toMatchObject(forbidden); // Settings
      await expect(adminAccess()).rejects.toMatchObject(forbidden); // Users, Roles and Activity log
      const { navFor } = await import("@/components/layout/nav");
      expect(navFor(viewer.grants)).not.toContain("/settings");
      const { saveSettings } = await import("@/lib/actions/settings");
      expect((await saveSettings({} as never)).ok).toBe(false);
      // An Admin can.
      current = person("Admin", { roles: ["Admin"] });
      await expect(settingsAccess()).resolves.toBeTruthy();
      await expect(adminAccess()).resolves.toBeTruthy();
    });
  });

  describe("still on a temporary password", () => {
    const loaderFiles = ["lib/data.ts", "lib/crm-data.ts", "lib/inventory-data.ts", "lib/inventory-insights.ts", "lib/orders-data.ts", "lib/planning-data.ts", "lib/planning-insights.ts", "lib/profile-data.ts", "lib/admin-data.ts"];
    const actionFiles = fs
      .readdirSync(path.resolve(__dirname, "../lib/actions"))
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      // Signing in, choosing the new password and signing out are what they are allowed to do.
      // Sign-in and PIN sign-in work before anyone is signed in; they check credentials themselves.
      .filter((f) => !["session.ts", "auth.ts", "floor.ts"].includes(f));

    it("every page loader sends them to 'Choose your new password'", async () => {
      current = newAdmin;
      const refused: string[] = [];
      const leaked: string[] = [];
      for (const f of loaderFiles) {
        const mod = (await import(/* @vite-ignore */ path.resolve(__dirname, "..", f))) as Record<string, unknown>;
        for (const [name, fn] of Object.entries(mod)) {
          if (typeof fn !== "function" || fn.constructor.name !== "AsyncFunction") continue;
          try {
            await (fn as (...a: unknown[]) => Promise<unknown>)();
            leaked.push(`${f}: ${name}`);
          } catch (e) {
            if (redirectTarget(e) === "/change-password") refused.push(name);
            else leaked.push(`${f}: ${name} (${e instanceof Error ? e.message : e})`);
          }
        }
      }
      expect(leaked).toEqual([]);
      expect(refused.length).toBeGreaterThan(60);
    });

    it("every server action refuses until they choose their password", async () => {
      current = newAdmin;
      const { CHANGE_PASSWORD_FIRST } = await import("@/lib/auth/guard");
      const allowed: string[] = [];
      let checked = 0;
      for (const f of actionFiles) {
        const mod = (await import(/* @vite-ignore */ path.resolve(__dirname, "../lib/actions", f))) as Record<string, unknown>;
        for (const [name, fn] of Object.entries(mod)) {
          if (typeof fn !== "function") continue;
          checked++;
          let r: unknown;
          try {
            r = await (fn as (...a: unknown[]) => Promise<unknown>)();
          } catch {
            continue; // refused by throwing
          }
          const res = r as { ok?: boolean; message?: string } | null;
          if (res == null) continue; // "nothing" (e.g. the auto-refresh check)
          if (res.ok === false && res.message === CHANGE_PASSWORD_FIRST) continue;
          allowed.push(`${f}: ${name} -> ${JSON.stringify(r).slice(0, 80)}`);
        }
      }
      expect(allowed).toEqual([]);
      expect(checked).toBeGreaterThan(100);
      // Nothing was written while they tried.
      const n = await db.execute<{ n: string }>(sql`select count(*) as n from ticket_events where created_by = 'New Admin'`);
      expect(Number(n.rows[0].n)).toBe(0);
    });
  });
});
