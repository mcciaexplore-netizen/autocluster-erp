import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const categoryEnum = pgEnum("company_category", ["OEM", "TIER1", "TIER2", "MSME"]);
export const unitTypeEnum = pgEnum("unit_type", ["PER_CC", "PER_HOUR", "PER_SAMPLE", "PER_HOUR_3_SAMPLES"]);
export const customerStatusEnum = pgEnum("customer_status", ["DRAFT", "ACTIVE"]);
export const quotationStatusEnum = pgEnum("quotation_status", ["DRAFT", "SENT", "ACCEPTED", "REJECTED"]);

const money = (name: string) => numeric(name, { precision: 14, scale: 2 });
const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const departments = pgTable("departments", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const services = pgTable(
  "services",
  {
    id: serial("id").primaryKey(),
    deptCode: text("dept_code")
      .notNull()
      .references(() => departments.code),
    name: text("name").notNull(),
    unitType: unitTypeEnum("unit_type").notNull(),
    unitLabel: text("unit_label").notNull(),
    rateMsme: money("rate_msme").notNull(),
    rateOem: money("rate_oem").notNull(),
    effectiveFrom: date("effective_from").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("services_dept_idx").on(t.deptCode)],
);

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyName: text("company_name").notNull(),
    category: categoryEnum("category").notNull(),
    udyamNo: text("udyam_no"),
    addressLine1: text("address_line1").notNull(),
    addressLine2: text("address_line2"),
    city: text("city").notNull(),
    state: text("state").notNull(),
    stateCode: text("state_code").notNull(),
    pincode: text("pincode").notNull(),
    gstRegistered: boolean("gst_registered").notNull().default(true),
    gstin: text("gstin"),
    pan: text("pan").notNull(),
    tan: text("tan"),
    pocName: text("poc_name").notNull(),
    pocDesignation: text("poc_designation"),
    pocPhone: text("poc_phone").notNull(),
    pocEmail: text("poc_email").notNull(),
    isMcciaMember: boolean("is_mccia_member").notNull().default(false),
    mcciaMembershipId: text("mccia_membership_id"),
    status: customerStatusEnum("status").notNull().default("DRAFT"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("customers_name_idx").on(t.companyName)],
);

export const customerDepartments = pgTable(
  "customer_departments",
  {
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    deptCode: text("dept_code")
      .notNull()
      .references(() => departments.code),
  },
  (t) => [primaryKey({ columns: [t.customerId, t.deptCode] })],
);

export const customerServices = pgTable(
  "customer_services",
  {
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    serviceId: integer("service_id")
      .notNull()
      .references(() => services.id),
  },
  (t) => [primaryKey({ columns: [t.customerId, t.serviceId] })],
);

/** Copy of the customer at the moment the quotation was made. */
export type CustomerSnapshot = {
  id: string;
  companyName: string;
  category: "OEM" | "TIER1" | "TIER2" | "MSME";
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  stateCode: string;
  pincode: string;
  gstRegistered: boolean;
  gstin: string | null;
  pan: string;
  pocName: string;
  pocDesignation: string | null;
  pocPhone: string;
  pocEmail: string;
  isMcciaMember: boolean;
  mcciaMembershipId: string | null;
};

export const quotations = pgTable(
  "quotations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quoteNo: text("quote_no").notNull(),
    fy: text("fy").notNull(),
    seq: integer("seq").notNull(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    customerSnapshot: jsonb("customer_snapshot").$type<CustomerSnapshot>().notNull(),
    priceType: text("price_type").notNull(),
    memberDiscountPct: numeric("member_discount_pct", { precision: 5, scale: 2 }).notNull().default("0"),
    gstPct: numeric("gst_pct", { precision: 5, scale: 2 }).notNull().default("18"),
    subject: text("subject").notNull(),
    quoteDate: date("quote_date").notNull(),
    validUntil: date("valid_until").notNull(),
    subtotal: money("subtotal").notNull(),
    discountTotal: money("discount_total").notNull(),
    taxableValue: money("taxable_value").notNull(),
    cgst: money("cgst").notNull().default("0"),
    sgst: money("sgst").notNull().default("0"),
    igst: money("igst").notNull().default("0"),
    roundOff: money("round_off").notNull().default("0"),
    grandTotal: money("grand_total").notNull(),
    status: quotationStatusEnum("status").notNull().default("DRAFT"),
    notes: text("notes"),
    terms: text("terms").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("quotations_quote_no_idx").on(t.quoteNo),
    uniqueIndex("quotations_fy_seq_idx").on(t.fy, t.seq),
    index("quotations_customer_idx").on(t.customerId),
    index("quotations_date_idx").on(t.quoteDate),
  ],
);

export const quotationItems = pgTable(
  "quotation_items",
  {
    id: serial("id").primaryKey(),
    quotationId: uuid("quotation_id")
      .notNull()
      .references(() => quotations.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
    serviceId: integer("service_id").references(() => services.id),
    deptCode: text("dept_code"),
    description: text("description").notNull(),
    unitType: unitTypeEnum("unit_type"),
    /** Unit text shown on the quotation, e.g. "per cc" or "per piece" for custom items. */
    unitLabel: text("unit_label").notNull(),
    hours: numeric("hours", { precision: 12, scale: 3 }),
    samples: integer("samples"),
    ccPerPart: numeric("cc_per_part", { precision: 12, scale: 3 }),
    parts: integer("parts"),
    billableQty: numeric("billable_qty", { precision: 14, scale: 3 }).notNull(),
    listRate: money("list_rate").notNull(),
    discountPct: numeric("discount_pct", { precision: 5, scale: 2 }).notNull().default("0"),
    finalRate: money("final_rate").notNull(),
    isCustomRate: boolean("is_custom_rate").notNull().default(false),
    isCustomItem: boolean("is_custom_item").notNull().default(false),
    amount: money("amount").notNull(),
    notes: text("notes"),
  },
  (t) => [index("quotation_items_quotation_idx").on(t.quotationId)],
);

/** Running quotation number per financial year. Never goes backwards, so numbers are never reused. */
export const quoteCounters = pgTable("quote_counters", {
  fy: text("fy").primaryKey(),
  lastSeq: integer("last_seq").notNull().default(0),
});

export const settings = pgTable("settings", {
  id: integer("id").primaryKey().default(1),
  orgName: text("org_name").notNull(),
  orgAddress: text("org_address").notNull(),
  orgGstin: text("org_gstin").notNull(),
  orgPhone: text("org_phone").notNull(),
  orgEmail: text("org_email").notNull(),
  logoUrl: text("logo_url"),
  memberDiscountPct: numeric("member_discount_pct", { precision: 5, scale: 2 }).notNull().default("10"),
  applyDiscountToNonMsme: boolean("apply_discount_to_non_msme").notNull().default(true),
  gstPct: numeric("gst_pct", { precision: 5, scale: 2 }).notNull().default("18"),
  homeStateCode: text("home_state_code").notNull().default("27"),
  quoteValidityDays: integer("quote_validity_days").notNull().default(30),
  quotePrefix: text("quote_prefix").notNull().default("ACDRI/QT"),
  defaultTerms: text("default_terms").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`)
    .$onUpdate(() => new Date()),
});

export type Department = typeof departments.$inferSelect;
export type Service = typeof services.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type Quotation = typeof quotations.$inferSelect;
export type QuotationItem = typeof quotationItems.$inferSelect;
export type Settings = typeof settings.$inferSelect;
