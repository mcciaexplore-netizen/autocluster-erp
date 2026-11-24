/**
 * Every permission in the app, grouped by area, with a plain description for the Roles page
 * (brief section 3.2), and the default roles (section 3.1). Pure: used by the app, the scripts
 * and the tests.
 *
 * "scoped" permissions only work on jobs, machines and items of the person's own departments
 * when their role says "Can only act on their own departments". Viewing is never scoped.
 */
export const PERMISSIONS = {
  // CRM
  "crm.view": { area: "CRM", label: "See enquiries and activities" },
  "crm.edit": { area: "CRM", label: "Add and change enquiries, activities and follow-ups" },
  "crm.stages": { area: "CRM", label: "Change the pipeline stages" },
  "crm.import": { area: "CRM", label: "Import enquiries from Excel" },
  // Customers
  "customers.view": { area: "Customers", label: "See customers" },
  "customers.edit": { area: "Customers", label: "Add and change customers" },
  // Quotations
  "quotes.view": { area: "Quotations", label: "See quotations" },
  "quotes.edit": { area: "Quotations", label: "Create, change and send quotations" },
  "quotes.status": { area: "Quotations", label: "Mark quotations Accepted or Rejected" },
  // Orders & Billing
  "orders.view": { area: "Orders & Billing", label: "See the Orders board and tickets" },
  "orders.po": { area: "Orders & Billing", label: "Add purchase orders" },
  "orders.billing": { area: "Orders & Billing", label: "Upload invoices and billing exports" },
  "orders.payments": { area: "Orders & Billing", label: "Record payments, reminders and follow-ups" },
  "orders.cancel": { area: "Orders & Billing", label: "Cancel tickets and move them back" },
  // Planning
  "planning.view": { area: "Planning", label: "See the timeline, jobs, machines and Today" },
  "planning.book": { area: "Planning", label: "Book, move and cancel machine time; change job details", scoped: true },
  "planning.blocks": { area: "Planning", label: "Block machine time and mark breakdowns", scoped: true },
  "planning.operate": { area: "Planning", label: "Start, pause, finish and hand over jobs (Today)", scoped: true },
  "planning.machines": { area: "Planning", label: "Add and change machines, working hours and holidays", scoped: true },
  // Inventory
  "inventory.view": { area: "Inventory", label: "See stock, items, suppliers and records" },
  "inventory.receive": { area: "Inventory", label: "Receive stock", scoped: true },
  "inventory.use": { area: "Inventory", label: "Use stock for jobs and internal use", scoped: true },
  "inventory.use_own_jobs": { area: "Inventory", label: "Record materials for their own jobs only", scoped: true },
  "inventory.adjust": { area: "Inventory", label: "Adjust stock and reverse records", scoped: true },
  "inventory.count": { area: "Inventory", label: "Run stock counts", scoped: true },
  "inventory.reorder": { area: "Inventory", label: "Send orders to suppliers" },
  "inventory.items": { area: "Inventory", label: "Add and change items, categories and units" },
  "inventory.suppliers": { area: "Inventory", label: "Add and change suppliers" },
  // Rate Card
  "ratecard.view": { area: "Rate Card", label: "See the Rate Card" },
  "ratecard.rates": { area: "Rate Card", label: "Change rates and switch services on or off" },
  "ratecard.time_materials": { area: "Rate Card", label: "Change time needed and materials lists" },
  // Insights
  "insights.crm": { area: "Insights", label: "CRM Insights" },
  "insights.orders": { area: "Insights", label: "Orders and money Insights" },
  "insights.planning": { area: "Insights", label: "Planning Insights" },
  "insights.inventory": { area: "Insights", label: "Inventory Insights" },
  // Money
  "money.sale_prices": { area: "Money", label: "See sale prices: rates, quotation and ticket values, kept after materials, earnings" },
  "money.stock_costs": { area: "Money", label: "See stock costs: purchase rates, average cost, stock value" },
  // Admin
  "settings.edit": { area: "Settings", label: "Change settings (organisation, lists, working hours)" },
  "users.manage": { area: "Settings", label: "Manage users, roles and the activity log" },
} as const satisfies Record<string, { area: string; label: string; scoped?: boolean }>;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];
export const isScoped = (p: Permission) => "scoped" in PERMISSIONS[p] && PERMISSIONS[p].scoped === true;
export const AREAS = [...new Set(ALL_PERMISSIONS.map((p) => PERMISSIONS[p].area))];

/** The Admin role always keeps these. */
export const ADMIN_LOCKED: Permission[] = ["users.manage", "settings.edit"];

const VIEW_ALL: Permission[] = ["crm.view", "customers.view", "quotes.view", "orders.view", "planning.view", "inventory.view", "ratecard.view"];
const INSIGHTS_ALL: Permission[] = ["insights.crm", "insights.orders", "insights.planning", "insights.inventory"];
const pick = (prefix: string) => ALL_PERMISSIONS.filter((p) => p.startsWith(prefix));

export interface DefaultRole {
  name: string;
  description: string;
  scopeOwnDepartments: boolean;
  permissions: Permission[];
}

/** Section 3.1. */
export const DEFAULT_ROLES: DefaultRole[] = [
  { name: "Admin", description: "Everything, including users, roles and settings.", scopeOwnDepartments: false, permissions: ALL_PERMISSIONS.filter((p) => p !== "inventory.use_own_jobs") },
  {
    name: "Manager",
    description: "Runs the work: everything except users, roles and settings.",
    scopeOwnDepartments: false,
    permissions: [...pick("crm."), "customers.view", "customers.edit", ...pick("quotes."), ...pick("orders."), ...pick("planning."), ...pick("inventory.").filter((p) => p !== "inventory.use_own_jobs"), ...pick("ratecard."), ...INSIGHTS_ALL, "money.sale_prices", "money.stock_costs"],
  },
  {
    name: "Sales",
    description: "Enquiries, customers and quotations. Sees the Orders board and Planning.",
    scopeOwnDepartments: false,
    permissions: ["crm.view", "crm.edit", "crm.import", "customers.view", "customers.edit", "quotes.view", "quotes.edit", "quotes.status", "orders.view", "planning.view", "ratecard.view", "insights.crm", "money.sale_prices"],
  },
  {
    name: "Accounts",
    description: "Purchase orders, invoices, payments and reminders. Sees everything else.",
    scopeOwnDepartments: false,
    permissions: ["crm.view", "customers.view", "quotes.view", ...pick("orders."), "planning.view", "inventory.view", "ratecard.view", "insights.orders", "money.sale_prices", "money.stock_costs"],
  },
  {
    name: "Planner",
    description: "Plans machine time and jobs in their departments. Uses stock and sets time and materials.",
    scopeOwnDepartments: true,
    permissions: ["customers.view", "quotes.view", "orders.view", ...pick("planning."), "inventory.view", "inventory.use", "ratecard.view", "ratecard.time_materials", "insights.planning"],
  },
  {
    name: "Operator",
    description: "Today: starts, pauses and finishes jobs in their departments, and records materials for them.",
    scopeOwnDepartments: true,
    permissions: ["planning.view", "planning.operate", "inventory.use_own_jobs"],
  },
  {
    name: "Store",
    description: "Stock: receiving, use, counts, orders, items and suppliers. Sees stock values.",
    scopeOwnDepartments: false,
    permissions: ["orders.view", "planning.view", ...pick("inventory.").filter((p) => p !== "inventory.use_own_jobs"), "ratecard.view", "insights.inventory", "money.stock_costs"],
  },
  { name: "Viewer", description: "Sees everything, changes nothing.", scopeOwnDepartments: false, permissions: [...VIEW_ALL, ...INSIGHTS_ALL, "money.sale_prices", "money.stock_costs"] },
];
