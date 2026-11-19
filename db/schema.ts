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
import {
  DEFAULT_EMAIL_BODY_TEMPLATE,
  DEFAULT_EMAIL_SUBJECT_TEMPLATE,
  DEFAULT_WHATSAPP_TEMPLATE,
} from "../lib/reminder-templates";

export const categoryEnum = pgEnum("company_category", ["OEM", "TIER1", "TIER2", "MSME"]);
export const unitTypeEnum = pgEnum("unit_type", ["PER_CC", "PER_HOUR", "PER_SAMPLE", "PER_HOUR_3_SAMPLES"]);
export const customerStatusEnum = pgEnum("customer_status", ["DRAFT", "ACTIVE"]);
export const quotationStatusEnum = pgEnum("quotation_status", ["DRAFT", "SENT", "ACCEPTED", "REJECTED"]);
export const ticketStageEnum = pgEnum("ticket_stage", ["WAITING_PO", "BILLING", "PAYMENT", "PAID", "CANCELLED"]);
export const fileKindEnum = pgEnum("file_kind", ["PO", "INVOICE"]);
export const paymentModeEnum = pgEnum("payment_mode", ["BANK", "UPI", "CHEQUE", "CASH"]);
export const followUpMethodEnum = pgEnum("follow_up_method", ["CALL", "WHATSAPP", "EMAIL", "VISIT", "OTHER"]);
export const exportMethodEnum = pgEnum("export_method", ["EXCEL_MANUAL", "TALLY"]);

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
    /** Days the customer gets to pay an invoice. */
    creditDays: integer("credit_days").notNull().default(30),
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
  ticketPrefix: text("ticket_prefix").notNull().default("ACDRI/TK"),
  defaultCreditDays: integer("default_credit_days").notNull().default(30),
  whatsappTemplate: text("whatsapp_template").notNull().default(DEFAULT_WHATSAPP_TEMPLATE),
  emailSubjectTemplate: text("email_subject_template").notNull().default(DEFAULT_EMAIL_SUBJECT_TEMPLATE),
  emailBodyTemplate: text("email_body_template").notNull().default(DEFAULT_EMAIL_BODY_TEMPLATE),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`)
    .$onUpdate(() => new Date()),
});

// ---------------------------------------------------------------------------
// Module 3: Orders & Billing
// ---------------------------------------------------------------------------

/** What a ticket was opened for, copied from the quotation line at that moment. */
export type TicketSnapshot = {
  quoteNo: string;
  companyName: string;
  deptCode: string | null;
  description: string;
  notes: string | null;
  quantityText: string;
  billableQty: string;
  unitLabel: string;
  listRate: string;
  finalRate: string;
  discountPct: string;
  isCustomRate: boolean;
  isCustomItem: boolean;
  intraState: boolean;
  gstPct: string;
  /** Share of the quotation's round off (only ever on the last ticket). */
  roundOff: string;
};

/** Running ticket number per financial year. Never goes backwards, so numbers are never reused. */
export const ticketCounters = pgTable("ticket_counters", {
  fy: text("fy").primaryKey(),
  lastSeq: integer("last_seq").notNull().default(0),
});

export const files = pgTable("files", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: fileKindEnum("kind").notNull(),
  blobPath: text("blob_path").notNull(),
  fileName: text("file_name").notNull(),
  size: integer("size").notNull(),
  mime: text("mime").notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
});

export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    poNumber: text("po_number").notNull(),
    poDate: date("po_date").notNull(),
    poAmount: money("po_amount").notNull(),
    fileId: uuid("file_id").references(() => files.id),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("purchase_orders_customer_po_idx").on(t.customerId, t.poNumber)],
);

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    invoiceNumber: text("invoice_number").notNull(),
    invoiceDate: date("invoice_date").notNull(),
    /** Invoice amount including GST. */
    amount: money("amount").notNull(),
    creditDays: integer("credit_days").notNull(),
    dueDate: date("due_date").notNull(),
    fileId: uuid("file_id").references(() => files.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("invoices_number_idx").on(t.invoiceNumber), index("invoices_customer_idx").on(t.customerId)],
);

export const tickets = pgTable(
  "tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketNo: text("ticket_no").notNull(),
    fy: text("fy").notNull(),
    seq: integer("seq").notNull(),
    quotationId: uuid("quotation_id")
      .notNull()
      .references(() => quotations.id),
    quotationItemId: integer("quotation_item_id")
      .notNull()
      .references(() => quotationItems.id),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    snapshot: jsonb("snapshot").$type<TicketSnapshot>().notNull(),
    listAmount: money("list_amount").notNull(),
    discountAmount: money("discount_amount").notNull(),
    taxableValue: money("taxable_value").notNull(),
    cgst: money("cgst").notNull().default("0"),
    sgst: money("sgst").notNull().default("0"),
    igst: money("igst").notNull().default("0"),
    totalAmount: money("total_amount").notNull(),
    stage: ticketStageEnum("stage").notNull().default("WAITING_PO"),
    stageChangedAt: timestamp("stage_changed_at", { withTimezone: true }).notNull().defaultNow(),
    poId: uuid("po_id").references(() => purchaseOrders.id),
    invoiceId: uuid("invoice_id").references(() => invoices.id),
    cancelReason: text("cancel_reason"),
    /** True when cancelled because the quotation stopped being Accepted (re-accepting reopens it). */
    autoCancelled: boolean("auto_cancelled").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("tickets_ticket_no_idx").on(t.ticketNo),
    uniqueIndex("tickets_fy_seq_idx").on(t.fy, t.seq),
    uniqueIndex("tickets_quotation_item_idx").on(t.quotationItemId),
    index("tickets_stage_idx").on(t.stage),
    index("tickets_customer_idx").on(t.customerId),
    index("tickets_quotation_idx").on(t.quotationId),
    index("tickets_invoice_idx").on(t.invoiceId),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id),
    amount: money("amount").notNull(),
    tdsAmount: money("tds_amount").notNull().default("0"),
    paidOn: date("paid_on").notNull(),
    mode: paymentModeEnum("mode").notNull(),
    reference: text("reference"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("payments_invoice_idx").on(t.invoiceId)],
);

export const followUps = pgTable(
  "follow_ups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id),
    method: followUpMethodEnum("method").notNull(),
    note: text("note").notNull(),
    promisedDate: date("promised_date"),
    nextFollowUpDate: date("next_follow_up_date"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("follow_ups_invoice_idx").on(t.invoiceId)],
);

export const ticketEvents = pgTable(
  "ticket_events",
  {
    id: serial("id").primaryKey(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    message: text("message").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>(),
    createdBy: text("created_by").notNull().default("Demo User"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ticket_events_ticket_idx").on(t.ticketId, t.createdAt)],
);

export const billingExports = pgTable("billing_exports", {
  id: uuid("id").primaryKey().defaultRandom(),
  ticketIds: jsonb("ticket_ids").$type<string[]>().notNull(),
  method: exportMethodEnum("method").notNull(),
  status: text("status").notNull().default("DONE"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Department = typeof departments.$inferSelect;
export type Service = typeof services.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type Quotation = typeof quotations.$inferSelect;
export type QuotationItem = typeof quotationItems.$inferSelect;
export type Settings = typeof settings.$inferSelect;
export type Ticket = typeof tickets.$inferSelect;
export type TicketStage = (typeof ticketStageEnum.enumValues)[number];
export type PurchaseOrder = typeof purchaseOrders.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type FollowUp = typeof followUps.$inferSelect;
export type FileRow = typeof files.$inferSelect;
export type TicketEvent = typeof ticketEvents.$inferSelect;
