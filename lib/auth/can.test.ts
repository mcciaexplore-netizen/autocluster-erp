import { describe, expect, it } from "vitest";
import { buildGrants, can, type Grants } from "./can";
import { ALL_PERMISSIONS, DEFAULT_ROLES, isScoped, type Permission } from "./permissions";

const role = (name: string) => {
  const r = DEFAULT_ROLES.find((x) => x.name === name)!;
  return { scopeOwnDepartments: r.scopeOwnDepartments, permissions: r.permissions as string[] };
};
const who = (roles: string[], depts: string[] | "all"): { grants: Grants } => ({
  grants: buildGrants(roles.map(role), depts === "all" ? { allDepartments: true, departments: [] } : { allDepartments: false, departments: depts }),
});

describe("can()", () => {
  it("an RPT operator can run RPT jobs but not PPF jobs, and still views Planning everywhere", () => {
    const rohan = who(["Operator"], ["RPT"]);
    expect(can(rohan, "planning.operate", { dept: "RPT" })).toBe(true);
    expect(can(rohan, "planning.operate", { dept: "PPF" })).toBe(false);
    expect(can(rohan, "planning.operate", { dept: null })).toBe(false);
    expect(can(rohan, "planning.view")).toBe(true);
    expect(can(rohan, "inventory.use_own_jobs", { dept: ["PPF", "RPT"] })).toBe(true); // an item in several departments
    expect(can(rohan, "inventory.use_own_jobs", { dept: ["PPF"] })).toBe(false);
    expect(can(rohan, "orders.view")).toBe(false);
    expect(can(rohan, "money.sale_prices")).toBe(false);
  });

  it("roles add up; a role without the department limit gives the permission everywhere", () => {
    const meera = who(["Planner", "Store"], ["RPT", "PPF", "MET"]);
    expect(can(meera, "planning.book", { dept: "ENV" })).toBe(false); // Planner: own departments only
    expect(can(meera, "planning.book", { dept: "PPF" })).toBe(true);
    expect(can(meera, "inventory.use", { dept: "ENV" })).toBe(true); // Store: everywhere
    expect(can(meera, "money.stock_costs")).toBe(true);
    expect(can(meera, "money.sale_prices")).toBe(false);
  });

  it("'All departments' lifts the limit", () => {
    expect(can(who(["Operator"], "all"), "planning.operate", { dept: "ENV" })).toBe(true);
  });

  it("nobody signed in can do nothing; unknown permissions in a role are ignored", () => {
    expect(can(null, "crm.view")).toBe(false);
    const g = buildGrants([{ scopeOwnDepartments: false, permissions: ["crm.view", "not.a.permission"] }], { allDepartments: true, departments: [] });
    expect(Object.keys(g)).toEqual(["crm.view"]);
  });
});

describe("default roles (section 3.1)", () => {
  const has = (r: string, p: Permission) => can(who([r], "all"), p);
  it("money: sale prices and stock costs", () => {
    const sale = DEFAULT_ROLES.filter((r) => has(r.name, "money.sale_prices")).map((r) => r.name);
    const stock = DEFAULT_ROLES.filter((r) => has(r.name, "money.stock_costs")).map((r) => r.name);
    expect(sale.sort()).toEqual(["Accounts", "Admin", "Manager", "Sales", "Viewer"]);
    expect(stock.sort()).toEqual(["Accounts", "Admin", "Manager", "Store", "Viewer"]);
  });
  it("only Admin manages users, roles and settings", () => {
    expect(DEFAULT_ROLES.filter((r) => has(r.name, "users.manage") || has(r.name, "settings.edit")).map((r) => r.name)).toEqual(["Admin"]);
  });
  it("Sales edits CRM but not stages; Accounts records payments; Store sees no quotations", () => {
    expect(has("Sales", "crm.edit") && !has("Sales", "crm.stages")).toBe(true);
    expect(has("Accounts", "orders.payments") && !has("Accounts", "ratecard.rates")).toBe(true);
    expect(has("Store", "quotes.view")).toBe(false);
    expect(has("Sales", "inventory.view")).toBe(false);
    expect(has("Viewer", "crm.edit") || has("Viewer", "orders.po") || has("Viewer", "inventory.receive")).toBe(false);
  });
  it("only Planner and Operator are limited to their own departments, and only scoped permissions are", () => {
    expect(DEFAULT_ROLES.filter((r) => r.scopeOwnDepartments).map((r) => r.name)).toEqual(["Planner", "Operator"]);
    expect(ALL_PERMISSIONS.filter(isScoped).every((p) => !p.endsWith(".view"))).toBe(true);
  });
});
