/**
 * The permission matrix (section 12): every server action and every route, called as every
 * default role, is allowed or refused exactly as section 3.1 says.
 *
 * - ROLE_TABLE is section 3.1 written out by hand (it does not read DEFAULT_ROLES), so a change to
 *   the default roles that breaks 3.1 fails here.
 * - The lists of actions and routes are read from the files, and every one must be in NEEDS (or in
 *   EXEMPT, with the reason): a new action or route can't be missed.
 * - "Refused" means the permission check said no; anything else (saved, or a "please check the
 *   details" answer to the empty test input) means the permission check let it through.
 */
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ensureDefaultRoles } from "@/db/role-writer";
import { buildGrants } from "@/lib/auth/can";
import type { CurrentUser } from "@/lib/auth/current-user";
import { ALL_PERMISSIONS, DEFAULT_ROLES, type Permission } from "@/lib/auth/permissions";
import { loadDemoData, wipe } from "@/scripts/demo-data";
import { testDb } from "./helpers";

const skip = !!process.env.SKIP_DB_TESTS;
const { db, pool } = testDb();

let current: CurrentUser | null = null;
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => current }));
vi.mock("@/db", () => ({ db }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));

// ---- Section 3.1, written out ------------------------------------------------------------------
const VIEW_ALL: Permission[] = ["crm.view", "customers.view", "quotes.view", "orders.view", "planning.view", "inventory.view", "ratecard.view"];
const INSIGHTS: Permission[] = ["insights.crm", "insights.orders", "insights.planning", "insights.inventory"];
const ORDERS_FULL: Permission[] = ["orders.view", "orders.po", "orders.billing", "orders.payments", "orders.cancel"];
const PLANNING_FULL: Permission[] = ["planning.view", "planning.book", "planning.blocks", "planning.operate", "planning.machines"];
const INVENTORY_FULL: Permission[] = ["inventory.view", "inventory.receive", "inventory.use", "inventory.adjust", "inventory.count", "inventory.reorder", "inventory.items", "inventory.suppliers"];
const ROLE_TABLE: Record<string, Permission[]> = {
  Admin: ALL_PERMISSIONS.filter((p) => p !== "inventory.use_own_jobs"),
  Manager: ["actions.on_behalf", "crm.view", "crm.edit", "crm.stages", "crm.import", "customers.view", "customers.edit", "quotes.view", "quotes.edit", "quotes.status", ...ORDERS_FULL, ...PLANNING_FULL, ...INVENTORY_FULL, "ratecard.view", "ratecard.rates", "ratecard.time_materials", ...INSIGHTS, "money.sale_prices", "money.stock_costs"],
  Sales: ["crm.view", "crm.edit", "crm.import", "customers.view", "customers.edit", "quotes.view", "quotes.edit", "quotes.status", "orders.view", "planning.view", "ratecard.view", "insights.crm", "money.sale_prices"],
  Accounts: ["crm.view", "customers.view", "quotes.view", ...ORDERS_FULL, "planning.view", "inventory.view", "ratecard.view", "insights.orders", "money.sale_prices", "money.stock_costs"],
  Planner: ["customers.view", "quotes.view", "orders.view", ...PLANNING_FULL, "inventory.view", "inventory.use", "ratecard.view", "ratecard.time_materials", "insights.planning"],
  Operator: ["planning.view", "planning.operate", "inventory.use_own_jobs"],
  Store: ["orders.view", "planning.view", ...INVENTORY_FULL, "ratecard.view", "insights.inventory", "money.stock_costs"],
  Viewer: [...VIEW_ALL, ...INSIGHTS, "money.sale_prices", "money.stock_costs"],
};

// ---- What each action and route needs ------------------------------------------------------------
/** any: allowed with any one of these. all: needs every one. args: what to call it with. */
type Need = { any?: Permission[]; all?: Permission[]; args?: unknown[] };
const p = (...any: Permission[]): Need[] => [{ any }];

const NEEDS: Record<string, Need[]> = {
  // CRM
  quickAddLeadAction: p("crm.edit"), moveLeadAction: p("crm.edit"), setLeadPriorityAction: p("crm.edit"), bulkMoveAction: p("crm.edit"), bulkAssignAction: p("crm.edit"),
  bulkAddTagAction: p("crm.edit"), deleteLeadsAction: p("crm.edit"), restoreLeadsAction: p("crm.edit"), loadLeadDetail: p("crm.view"), createLeadAction: p("crm.edit"),
  updateLeadAction: p("crm.edit"), addLeadNoteAction: p("crm.edit"), logLeadContactAction: p("crm.edit"), findDuplicatesAction: p("crm.view"), createTagAction: p("crm.edit"),
  planActivityAction: p("crm.edit"), markActivityDoneAction: p("crm.edit"), cancelActivityAction: p("crm.edit"), linkLeadToCustomerAction: p("crm.edit"),
  setStageFoldedAction: p("crm.stages"), renameStageAction: p("crm.stages"), setStageColorAction: p("crm.stages"), setStageProbabilityAction: p("crm.stages"),
  addStageAction: p("crm.stages"), reorderStagesAction: p("crm.stages"), moveStageAction: p("crm.stages"), deleteStageAction: p("crm.stages"),
  previewImportAction: p("crm.import"), importLeadsAction: p("crm.import"), problemRowsAction: p("crm.import"),
  // Settings lists (sources, lost reasons, tags, inventory lists)
  addCrmListItem: p("settings.edit"), updateCrmListItem: p("settings.edit"), setCrmListItemActive: p("settings.edit"), moveCrmListItem: p("settings.edit"), deleteCrmListItem: p("settings.edit"),
  saveSettings: p("settings.edit"),
  // Customers and quotations
  saveCustomerDetails: p("customers.edit"), saveCustomerLinks: p("customers.edit"), deleteCustomer: p("customers.edit"), restoreCustomer: p("customers.edit"),
  saveQuotation: p("quotes.edit"), duplicateQuotation: p("quotes.edit"),
  previewStatusChange: [{ any: ["quotes.status"], args: ["00000000-0000-4000-8000-000000000000", "ACCEPTED"] }, { any: ["quotes.edit"], args: ["00000000-0000-4000-8000-000000000000", "SENT"] }],
  setQuotationStatus: [{ any: ["quotes.status"], args: ["00000000-0000-4000-8000-000000000000", "REJECTED"] }, { any: ["quotes.edit"], args: ["00000000-0000-4000-8000-000000000000", "SENT"] }],
  // Orders & Billing
  loadTicketDetail: p("orders.view"), moveTicketBackAction: p("orders.cancel"), cancelTicketAction: p("orders.cancel"), checkPoNumber: p("orders.po"), addPoAction: p("orders.po"),
  checkInvoiceNumber: p("orders.billing"), addInvoiceAction: p("orders.billing"), recordPaymentAction: p("orders.payments"), addFollowUpAction: p("orders.payments"),
  loadReminder: p("orders.payments"), logReminderAction: p("orders.payments"),
  registerUpload: [
    { any: ["orders.po"], args: [{ kind: "PO" }] },
    { any: ["orders.billing"], args: [{ kind: "INVOICE" }] },
    { any: ["inventory.receive"], args: [{ kind: "BILL" }] },
    { any: ["planning.book", "planning.operate"], args: [{ kind: "JOB" }] },
  ],
  // Planning
  saveJobDetailsAction: p("planning.book"), bulkJobsAction: p("planning.book"), bulkMarkDoneAction: p("planning.book"), bookTimeAction: p("planning.book"), bookSlotAction: p("planning.book"),
  findSlotsAction: p("planning.view"), moveBookingAction: p("planning.book"), cancelBookingAction: p("planning.book"), extendHoldAction: p("planning.book"), moveToNextFreeSlotAction: p("planning.book"),
  addJobFileAction: p("planning.book", "planning.operate"), removeJobFileAction: p("planning.book", "planning.operate"), loadJobPanelAction: p("planning.view"), loadBookJobAction: p("planning.book"),
  earliestSlotForServiceAction: [{ any: ["planning.view", "quotes.edit"], args: [1, 1] }], // a real service: refused answers null
  saveMachineAction: p("planning.machines"), blockTimeAction: p("planning.blocks"), markBreakdownAction: p("planning.blocks"), extendBreakdownAction: p("planning.blocks"), markFixedAction: p("planning.blocks"),
  deleteBlockAction: p("planning.blocks"), addHolidayAction: p("planning.machines"), deleteHolidayAction: p("planning.machines"), importHolidaysAction: p("planning.machines"),
  startJobAction: p("planning.operate"), pauseJobAction: p("planning.operate"), holdJobAction: p("planning.operate", "planning.book"), finishJobAction: p("planning.operate"),
  handOverAction: p("planning.operate"), readySentAction: p("planning.operate"),
  // Rate Card
  updateRates: p("ratecard.rates"), setServiceActive: p("ratecard.rates"), setNoMaterialsNeeded: p("ratecard.time_materials"), saveServiceTimeAction: p("ratecard.time_materials"), setServiceMaterialsAction: p("ratecard.time_materials"),
  // Inventory
  saveItemAction: p("inventory.items"), saveSupplierAction: p("inventory.suppliers"), previewItemImportAction: p("inventory.items"), importItemsAction: p("inventory.items"), itemProblemRowsAction: p("inventory.items"),
  receiveStockAction: p("inventory.receive"), issueStockAction: p("inventory.use", "inventory.use_own_jobs"), adjustStockAction: p("inventory.adjust"), reverseDocumentAction: p("inventory.adjust"),
  startCountAction: p("inventory.count"), saveCountLineAction: p("inventory.count"), completeCountAction: p("inventory.count"), discardCountAction: p("inventory.count"),
  markOrderedAction: p("inventory.reorder"), clearOrderedAction: p("inventory.reorder"),
  // Auto-refresh
  changedSinceAction: [{ any: ["crm.view"], args: ["crm", null] }, { any: ["orders.view"], args: ["orders", null] }, { any: ["inventory.view"], args: ["inventory", null] }],
  // Users, roles, shared devices, PINs
  saveUserAction: p("users.manage"), resetPasswordAction: p("users.manage"), deactivateUserAction: p("users.manage"), reactivateUserAction: p("users.manage"), signOutUserAction: p("users.manage"),
  saveRoleAction: p("users.manage"), copyRoleAction: p("users.manage"), deleteRoleAction: p("users.manage"), markThisDeviceSharedAction: p("users.manage"), stopSharingThisDeviceAction: p("users.manage"),
  revokeDeviceAction: p("users.manage"), setUserPinAction: p("users.manage"), clearUserPinAction: p("users.manage"),
};

/** Actions every signed-in person (or nobody) may use; they check their own credentials. */
const EXEMPT: Record<string, string> = {
  signIn: "the demo password gate, before anyone signs in",
  signInWithPassword: "signing in", signOutAction: "signing out", chooseNewPassword: "their own first password", changePassword: "their own password",
  updateProfile: "their own name and mobile", signOutSession: "their own devices", signOutEverywhere: "their own devices", setOwnPin: "their own PIN",
  tryAsAction: "demo sign-in (demo site only, tested in demo-mode.db.test.ts)",
  pinSignInAction: "PIN sign-in on a shared device (tested in floor.db.test.ts)", floorSignOutAction: "ending a PIN session",
};

const ROUTE_NEEDS: Record<string, Need[]> = {
  "billing-export:POST": p("orders.billing"),
  "activity/export:GET": p("users.manage"),
  "crm/import-template:GET": p("crm.import"),
  "crm/export:GET": p("crm.view"),
  "planning/insights:GET": p("insights.planning"),
  "planning/holidays-template:GET": p("planning.machines"),
  "planning/jobs/export:GET": p("planning.view"),
  "inventory/insights:GET": p("insights.inventory"),
  "inventory/import-template:GET": p("inventory.items"),
  "inventory/reorder/excel:GET": p("inventory.view"),
  "inventory/movements/export:GET": p("inventory.view"),
  "inventory/items/[id]/history:GET": p("inventory.view"),
  // Who may see a document depends on its kind (filled in with real files below).
  "files/[id]:GET": [],
};
const ROUTE_EXEMPT: Record<string, string> = {
  "auth/[...all]:GET": "Better Auth itself (sign-in, sessions)",
  "auth/[...all]:POST": "Better Auth itself (sign-in, sessions)",
  "cron/clean-up:GET": "Vercel Cron only, by secret (tested in retention.db.test.ts)",
  "files/upload:POST": "same permission table as registerUpload (UPLOAD_PERMS), checked above; needs file storage",
};

// ---- Helpers ---------------------------------------------------------------------------------------
const ROLES = Object.keys(ROLE_TABLE);
const roleUser = (role: string): CurrentUser => {
  const r = DEFAULT_ROLES.find((x) => x.name === role)!;
  const grants = buildGrants([{ scopeOwnDepartments: r.scopeOwnDepartments, permissions: r.permissions as string[] }], { allDepartments: true, departments: [] });
  return { id: "00000000-0000-4000-8000-0000000000aa", authUserId: "t", sessionId: "t", name: `Test ${role}`, email: "t@example.com", mobile: null, teamMemberId: "00000000-0000-4000-8000-0000000000bb", mustChangePassword: false, isDemo: false, allDepartments: true, departments: [], roles: [{ id: 1, name: role }], grants };
};
const expected = (role: string, n: Need) => {
  const has = new Set(ROLE_TABLE[role]);
  return (n.any ? n.any.some((x) => has.has(x)) : true) && (n.all ? n.all.every((x) => has.has(x)) : true);
};
const DENIED = /^(You don't have permission to|You can only do this in your own departments)/;
/** These answer null when not allowed (so they're called with real input, where allowed answers something). */
const NULL_WHEN_REFUSED = new Set(["changedSinceAction", "earliestSlotForServiceAction"]);
const isRefused = (name: string, result: unknown, thrown: unknown) => {
  if (thrown) return (thrown as { digest?: string }).digest === "NEXT_HTTP_ERROR_FALLBACK;403"; // forbidden()
  if (result === null) return NULL_WHEN_REFUSED.has(name);
  const m = (result as { ok?: boolean; message?: string; error?: string } | undefined)?.message;
  return typeof m === "string" && DENIED.test(m);
};

const actionsDir = path.resolve(__dirname, "../lib/actions");
const routesDir = path.resolve(__dirname, "../app/api");
const routeFiles = (dir: string, base = ""): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? routeFiles(path.join(dir, e.name), base ? `${base}/${e.name}` : e.name) : e.name === "route.ts" ? [base] : []));

describe.skipIf(skip)("permission matrix: every action and route, as every default role (section 3.1)", () => {
  beforeAll(async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN; // never upload from tests
    await db.transaction(async (tx) => {
      await wipe(tx);
      await loadDemoData(tx, { quiet: true, orders: { blobFolder: "local" }, crm: true, inventory: true });
    });
    await ensureDefaultRoles(db);
  }, 180_000);
  afterAll(() => pool.end());

  it("the default roles give exactly the permissions of section 3.1", () => {
    for (const r of DEFAULT_ROLES) expect([...r.permissions].sort(), r.name).toEqual([...ROLE_TABLE[r.name]].sort());
  });

  it("every server action is listed, and is allowed or refused for each role exactly as 3.1 says", async () => {
    const wrong: string[] = [];
    const unlisted: string[] = [];
    let calls = 0;
    for (const f of fs.readdirSync(actionsDir).filter((x) => x.endsWith(".ts") && !x.endsWith(".test.ts"))) {
      const mod = (await import(/* @vite-ignore */ path.join(actionsDir, f))) as Record<string, unknown>;
      for (const [name, fn] of Object.entries(mod)) {
        if (typeof fn !== "function") continue;
        if (EXEMPT[name]) continue;
        const needs = NEEDS[name];
        if (!needs) {
          unlisted.push(`${f}: ${name}`);
          continue;
        }
        for (const need of needs) {
          for (const role of ROLES) {
            current = roleUser(role);
            let result: unknown;
            let thrown: unknown;
            try {
              result = await (fn as (...a: unknown[]) => Promise<unknown>)(...(need.args ?? []));
            } catch (e) {
              thrown = e;
            }
            calls++;
            const refused = isRefused(name, result, thrown);
            if (refused === expected(role, need)) wrong.push(`${name}${need.args ? `(${JSON.stringify(need.args)})` : ""} as ${role}: ${refused ? "refused" : "allowed"}, should be ${refused ? "allowed" : "refused"}`);
          }
        }
      }
    }
    current = null;
    expect(unlisted, "add these to NEEDS (or EXEMPT)").toEqual([]);
    expect(wrong).toEqual([]);
    expect(calls).toBeGreaterThan(900);
  }, 300_000);

  it("every route is listed, and is allowed or refused for each role exactly as 3.1 says", async () => {
    // Documents: who may see each kind (section 3.1: prices for POs and invoices, stock costs for supplier bills).
    const fileOf = async (kind: string) => (await db.execute<{ id: string }>(sql`select id from files where kind = ${kind} limit 1`)).rows[0]?.id;
    const [po, inv, bill] = [await fileOf("PO"), await fileOf("INVOICE"), await fileOf("BILL")];
    const fileNeeds: Need[] = [];
    if (po) fileNeeds.push({ all: ["orders.view", "money.sale_prices"], args: [po] });
    if (inv) fileNeeds.push({ all: ["orders.view", "money.sale_prices"], args: [inv] });
    if (bill) fileNeeds.push({ all: ["inventory.view", "money.stock_costs"], args: [bill] });
    expect(fileNeeds.length).toBeGreaterThanOrEqual(2);
    const item = (await db.execute<{ id: string }>(sql`select id from inv_items limit 1`)).rows[0]?.id ?? "00000000-0000-4000-8000-000000000000";

    const wrong: string[] = [];
    const unlisted: string[] = [];
    for (const r of routeFiles(routesDir)) {
      const mod = (await import(/* @vite-ignore */ path.join(routesDir, r, "route.ts"))) as Record<string, unknown>;
      for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
        const fn = mod[method];
        if (typeof fn !== "function") continue;
        const key = `${r}:${method}`;
        if (ROUTE_EXEMPT[key]) continue;
        const needs = key === "files/[id]:GET" ? fileNeeds : ROUTE_NEEDS[key];
        if (!needs) {
          unlisted.push(key);
          continue;
        }
        for (const need of needs) {
          for (const role of ROLES) {
            current = roleUser(role);
            const id = (need.args?.[0] as string | undefined) ?? item;
            const req = new Request(`http://localhost/api/${r.replace("[id]", id)}`, method === "GET" ? {} : { method, body: "{}", headers: { "content-type": "application/json" } });
            let status = 0;
            try {
              const res = (await (fn as (req: Request, ctx: unknown) => Promise<Response>)(req, { params: Promise.resolve({ id }) })) as Response;
              status = res.status;
            } catch {
              status = 500; // got past the check, then failed on the empty test input
            }
            const refused = status === 403;
            if (refused === expected(role, need)) wrong.push(`${key}${need.args ? ` (${need.args[0]})` : ""} as ${role}: ${refused ? "refused" : `allowed (${status})`}, should be ${refused ? "allowed" : "refused"}`);
          }
        }
      }
    }
    current = null;
    expect(unlisted, "add these to ROUTE_NEEDS (or ROUTE_EXEMPT)").toEqual([]);
    expect(wrong).toEqual([]);
  }, 300_000);
});
