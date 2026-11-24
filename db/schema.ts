import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  bigint,
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
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  DEFAULT_EMAIL_BODY_TEMPLATE,
  DEFAULT_EMAIL_SUBJECT_TEMPLATE,
  DEFAULT_WHATSAPP_TEMPLATE,
} from "../lib/reminder-templates";
import {
  DEFAULT_LEAD_EMAIL_BODY_TEMPLATE,
  DEFAULT_LEAD_EMAIL_SUBJECT_TEMPLATE,
  DEFAULT_LEAD_WHATSAPP_TEMPLATE,
} from "../lib/crm/templates";
import {
  DEFAULT_ORDER_EMAIL_BODY_TEMPLATE,
  DEFAULT_ORDER_EMAIL_SUBJECT_TEMPLATE,
  DEFAULT_ORDER_WHATSAPP_TEMPLATE,
} from "../lib/inventory/templates";
import { DEFAULT_READY_WHATSAPP_TEMPLATE } from "../lib/planning/templates";

export const categoryEnum = pgEnum("company_category", ["OEM", "TIER1", "TIER2", "MSME"]);
export const unitTypeEnum = pgEnum("unit_type", ["PER_CC", "PER_HOUR", "PER_SAMPLE", "PER_HOUR_3_SAMPLES"]);
export const customerStatusEnum = pgEnum("customer_status", ["DRAFT", "ACTIVE"]);
export const quotationStatusEnum = pgEnum("quotation_status", ["DRAFT", "SENT", "ACCEPTED", "REJECTED"]);
export const ticketStageEnum = pgEnum("ticket_stage", ["WAITING_PO", "BILLING", "PAYMENT", "PAID", "CANCELLED"]);
export const fileKindEnum = pgEnum("file_kind", ["PO", "INVOICE", "BILL", "JOB"]);
export const paymentModeEnum = pgEnum("payment_mode", ["BANK", "UPI", "CHEQUE", "CASH"]);
export const followUpMethodEnum = pgEnum("follow_up_method", ["CALL", "WHATSAPP", "EMAIL", "VISIT", "OTHER"]);
export const exportMethodEnum = pgEnum("export_method", ["EXCEL_MANUAL", "TALLY"]);
export const crmStageTypeEnum = pgEnum("crm_stage_type", ["OPEN", "WON", "LOST"]);
export const invDocTypeEnum = pgEnum("inv_doc_type", ["IN", "OUT", "ADJ"]);
export const machineStatusEnum = pgEnum("machine_status", ["AVAILABLE", "MAINTENANCE", "BREAKDOWN", "INACTIVE"]);
export const machineBlockTypeEnum = pgEnum("machine_block_type", ["MAINTENANCE", "CALIBRATION", "BREAKDOWN", "INTERNAL", "OTHER"]);
export const jobStatusEnum = pgEnum("job_status", ["TO_PLAN", "PLANNED", "RUNNING", "ON_HOLD", "DONE", "HANDED_OVER", "CANCELLED"]);
export const jobPriorityEnum = pgEnum("job_priority", ["NORMAL", "URGENT"]);
export const invCountStatusEnum = pgEnum("inv_count_status", ["IN_PROGRESS", "COMPLETED"]);
export const crmActivityTypeEnum = pgEnum("crm_activity_type", ["CALL", "MEETING", "EMAIL", "WHATSAPP", "SITE_VISIT", "FOLLOW_UP"]);

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
    /** Module 6: used only to suggest a job's time needed (setup + minutes per billing unit). */
    setupMinutes: integer("setup_minutes"),
    minutesPerUnit: numeric("minutes_per_unit", { precision: 10, scale: 2 }),
    /** Rate Card "No materials needed": the service uses no stock (e.g. a chamber test), so kept after materials is 100%. */
    noMaterialsNeeded: boolean("no_materials_needed").notNull().default(false),
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
    /** The CRM enquiry this quotation was made from (Module 4). */
    leadId: uuid("lead_id").references((): AnyPgColumn => leads.id),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("quotations_quote_no_idx").on(t.quoteNo),
    index("quotations_lead_idx").on(t.leadId),
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
  // Module 4: CRM
  leadPrefix: text("lead_prefix").notNull().default("ACDRI/EN"),
  leadWhatsappTemplate: text("lead_whatsapp_template").notNull().default(DEFAULT_LEAD_WHATSAPP_TEMPLATE),
  leadEmailSubjectTemplate: text("lead_email_subject_template").notNull().default(DEFAULT_LEAD_EMAIL_SUBJECT_TEMPLATE),
  leadEmailBodyTemplate: text("lead_email_body_template").notNull().default(DEFAULT_LEAD_EMAIL_BODY_TEMPLATE),
  /** Stage an enquiry moves to when a quotation is created from it. Empty = don't move. */
  quoteCreatedMoveToStageId: uuid("quote_created_move_to_stage_id"),
  // Module 5: Inventory
  invInPrefix: text("inv_in_prefix").notNull().default("ACDRI/IN"),
  invOutPrefix: text("inv_out_prefix").notNull().default("ACDRI/OUT"),
  invAdjPrefix: text("inv_adj_prefix").notNull().default("ACDRI/ADJ"),
  invItemPrefix: text("inv_item_prefix").notNull().default("ITM"),
  invExpiryWarningDays: integer("inv_expiry_warning_days").notNull().default(30),
  invAvgUseDays: integer("inv_avg_use_days").notNull().default(90),
  invSafetyDays: integer("inv_safety_days").notNull().default(7),
  /** Used when an item has no lead time of its own (and none for its supplier). */
  invDefaultLeadTimeDays: integer("inv_default_lead_time_days").notNull().default(14),
  invPriceRiseAlertPct: integer("inv_price_rise_alert_pct").notNull().default(10),
  invMaterialShareAlertPct: integer("inv_material_share_alert_pct").notNull().default(40),
  invOrderWhatsappTemplate: text("inv_order_whatsapp_template").notNull().default(DEFAULT_ORDER_WHATSAPP_TEMPLATE),
  invOrderEmailSubjectTemplate: text("inv_order_email_subject_template").notNull().default(DEFAULT_ORDER_EMAIL_SUBJECT_TEMPLATE),
  invOrderEmailBodyTemplate: text("inv_order_email_body_template").notNull().default(DEFAULT_ORDER_EMAIL_BODY_TEMPLATE),
  // Module 6: Planning (working hours, India time)
  /** ISO weekdays that are working days: 1 = Monday ... 7 = Sunday. */
  workingDays: integer("working_days").array().notNull().default(sql`'{1,2,3,4,5,6}'::integer[]`),
  shiftStart: text("shift_start").notNull().default("09:00"),
  shiftEnd: text("shift_end").notNull().default("18:00"),
  breakStart: text("break_start").default("13:00"),
  breakEnd: text("break_end").default("13:30"),
  tentativeHoldDays: integer("tentative_hold_days").notNull().default(7),
  overrunWarningPct: integer("overrun_warning_pct").notNull().default(50),
  actualVsQuotedAlertPct: integer("actual_vs_quoted_alert_pct").notNull().default(10),
  readyWhatsappTemplate: text("ready_whatsapp_template").notNull().default(DEFAULT_READY_WHATSAPP_TEMPLATE),
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

// ---------------------------------------------------------------------------
// Module 4: CRM (enquiries pipeline)
// ---------------------------------------------------------------------------

export const crmStages = pgTable(
  "crm_stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    /** One of the preset colour keys in lib/crm/stages.ts, e.g. "blue". */
    color: text("color").notNull().default("grey"),
    sortOrder: integer("sort_order").notNull().default(0),
    type: crmStageTypeEnum("type").notNull().default("OPEN"),
    probability: integer("probability").notNull().default(10),
    isFolded: boolean("is_folded").notNull().default(false),
    ...timestamps,
  },
  (t) => [index("crm_stages_sort_idx").on(t.sortOrder)],
);

/** Who changed the pipeline stages, what and when. */
export const crmStageChanges = pgTable("crm_stage_changes", {
  id: serial("id").primaryKey(),
  action: text("action").notNull(),
  details: jsonb("details").$type<Record<string, unknown>>(),
  createdBy: text("created_by").notNull().default("Demo User"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const crmSources = pgTable("crm_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
});

export const crmLostReasons = pgTable("crm_lost_reasons", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
});

export const crmTags = pgTable("crm_tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
});

/** People enquiries can be assigned to. Names only, not sign-in accounts. */
export const teamMembers = pgTable("team_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  phone: text("phone"),
  email: text("email"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
});

/** Running enquiry number per financial year. Never goes backwards, so numbers are never reused. */
export const leadCounters = pgTable("lead_counters", {
  fy: text("fy").primaryKey(),
  lastSeq: integer("last_seq").notNull().default(0),
});

export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadNo: text("lead_no").notNull(),
    fy: text("fy").notNull(),
    seq: integer("seq").notNull(),
    title: text("title").notNull(),
    customerId: uuid("customer_id").references(() => customers.id),
    companyName: text("company_name").notNull(),
    contactName: text("contact_name").notNull(),
    designation: text("designation"),
    phone: text("phone"),
    email: text("email"),
    city: text("city"),
    category: categoryEnum("category"),
    isMcciaMember: boolean("is_mccia_member"),
    mcciaMembershipId: text("mccia_membership_id"),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => crmSources.id),
    stageId: uuid("stage_id")
      .notNull()
      .references(() => crmStages.id),
    priority: integer("priority").notNull().default(0),
    /** Expected value in paise. */
    expectedValue: bigint("expected_value", { mode: "number" }),
    expectedCloseDate: date("expected_close_date"),
    assignedTo: uuid("assigned_to").references(() => teamMembers.id),
    notes: text("notes"),
    lostReasonId: uuid("lost_reason_id").references(() => crmLostReasons.id),
    lostNote: text("lost_note"),
    wonAt: timestamp("won_at", { withTimezone: true }),
    lostAt: timestamp("lost_at", { withTimezone: true }),
    stageChangedAt: timestamp("stage_changed_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("leads_lead_no_idx").on(t.leadNo),
    uniqueIndex("leads_fy_seq_idx").on(t.fy, t.seq),
    index("leads_stage_idx").on(t.stageId),
    index("leads_customer_idx").on(t.customerId),
    index("leads_assigned_idx").on(t.assignedTo),
  ],
);

export const leadDepartments = pgTable(
  "lead_departments",
  {
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    deptCode: text("dept_code")
      .notNull()
      .references(() => departments.code),
  },
  (t) => [primaryKey({ columns: [t.leadId, t.deptCode] })],
);

export const leadServices = pgTable(
  "lead_services",
  {
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    serviceId: integer("service_id")
      .notNull()
      .references(() => services.id),
  },
  (t) => [primaryKey({ columns: [t.leadId, t.serviceId] })],
);

export const leadTags = pgTable(
  "lead_tags",
  {
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => crmTags.id),
  },
  (t) => [primaryKey({ columns: [t.leadId, t.tagId] })],
);

export const crmActivities = pgTable(
  "crm_activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    type: crmActivityTypeEnum("type").notNull(),
    dueDate: date("due_date").notNull(),
    dueTime: time("due_time"),
    note: text("note"),
    assignedTo: uuid("assigned_to").references(() => teamMembers.id),
    doneAt: timestamp("done_at", { withTimezone: true }),
    outcome: text("outcome"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("crm_activities_lead_idx").on(t.leadId), index("crm_activities_due_idx").on(t.dueDate)],
);

export const leadEvents = pgTable(
  "lead_events",
  {
    id: serial("id").primaryKey(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    message: text("message").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>(),
    createdBy: text("created_by").notNull().default("Demo User"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("lead_events_lead_idx").on(t.leadId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Module 5: Inventory
// Quantities numeric(14,3); unit costs numeric(14,4) in rupees; values integer paise.
// ---------------------------------------------------------------------------

const qty = (name: string) => numeric(name, { precision: 14, scale: 3 });
const rate = (name: string) => numeric(name, { precision: 14, scale: 4 });
const listTable = (name: string) =>
  pgTable(name, {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
  });

export const invCategories = listTable("inv_categories");
export const invUnits = listTable("inv_units");
export const invPurposes = listTable("inv_purposes");
export const invAdjustReasons = listTable("inv_adjust_reasons");

/** Running numbers: "IN:2026-27", "OUT:2026-27", "ADJ:2026-27", "ITEM", "COUNT". Never go backwards. */
export const invCounters = pgTable("inv_counters", {
  key: text("key").primaryKey(),
  lastSeq: integer("last_seq").notNull().default(0),
});

export const invSuppliers = pgTable(
  "inv_suppliers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    contactName: text("contact_name"),
    phone: text("phone"),
    email: text("email"),
    gstin: text("gstin"),
    address: text("address"),
    notes: text("notes"),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => [index("inv_suppliers_name_idx").on(t.name)],
);

export const invItems = pgTable(
  "inv_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => invCategories.id),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => invUnits.id),
    packName: text("pack_name"),
    packSize: qty("pack_size"),
    reorderLevel: qty("reorder_level").notNull().default("0"),
    reorderQty: qty("reorder_qty").notNull().default("0"),
    leadTimeDays: integer("lead_time_days"),
    preferredSupplierId: uuid("preferred_supplier_id").references(() => invSuppliers.id),
    storagePlace: text("storage_place"),
    trackBatches: boolean("track_batches").notNull().default(false),
    hsnCode: text("hsn_code"),
    notes: text("notes"),
    isActive: boolean("is_active").notNull().default(true),
    /** Kept up to date in the same transaction as every movement (fast reads). */
    qtyOnHand: qty("qty_on_hand").notNull().default("0"),
    avgCost: rate("avg_cost").notNull().default("0"),
    lastPurchaseRate: rate("last_purchase_rate"),
    orderedOn: date("ordered_on"),
    orderedSupplierId: uuid("ordered_supplier_id").references(() => invSuppliers.id),
    ...timestamps,
  },
  (t) => [uniqueIndex("inv_items_code_idx").on(t.code), index("inv_items_name_idx").on(t.name)],
);

export const invItemDepartments = pgTable(
  "inv_item_departments",
  {
    itemId: uuid("item_id")
      .notNull()
      .references(() => invItems.id, { onDelete: "cascade" }),
    deptCode: text("dept_code")
      .notNull()
      .references(() => departments.code),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.deptCode] })],
);

export const invSupplierItems = pgTable(
  "inv_supplier_items",
  {
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => invSuppliers.id),
    itemId: uuid("item_id")
      .notNull()
      .references(() => invItems.id),
    lastRate: rate("last_rate"),
    lastRateDate: date("last_rate_date"),
    leadTimeDays: integer("lead_time_days"),
  },
  (t) => [primaryKey({ columns: [t.supplierId, t.itemId] })],
);

export const invBatches = pgTable(
  "inv_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => invItems.id),
    batchNo: text("batch_no").notNull(),
    expiryDate: date("expiry_date"),
    qtyOnHand: qty("qty_on_hand").notNull().default("0"),
    receivedOn: date("received_on").notNull(),
  },
  (t) => [uniqueIndex("inv_batches_item_batch_idx").on(t.itemId, t.batchNo), index("inv_batches_expiry_idx").on(t.expiryDate)],
);

export const invDocuments = pgTable(
  "inv_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    docNo: text("doc_no").notNull(),
    fy: text("fy").notNull(),
    seq: integer("seq").notNull(),
    type: invDocTypeEnum("type").notNull(),
    docDate: date("doc_date").notNull(),
    supplierId: uuid("supplier_id").references(() => invSuppliers.id),
    supplierBillNo: text("supplier_bill_no"),
    supplierBillDate: date("supplier_bill_date"),
    fileId: uuid("file_id").references(() => files.id),
    ticketId: uuid("ticket_id").references(() => tickets.id),
    purposeId: uuid("purpose_id").references(() => invPurposes.id),
    reversesDocId: uuid("reverses_doc_id").references((): AnyPgColumn => invDocuments.id),
    reversedByDocId: uuid("reversed_by_doc_id").references((): AnyPgColumn => invDocuments.id),
    doneBy: uuid("done_by").references(() => teamMembers.id),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("inv_documents_no_idx").on(t.docNo),
    uniqueIndex("inv_documents_type_fy_seq_idx").on(t.type, t.fy, t.seq),
    index("inv_documents_date_idx").on(t.docDate),
    index("inv_documents_ticket_idx").on(t.ticketId),
    index("inv_documents_supplier_idx").on(t.supplierId),
  ],
);

export const invMovements = pgTable(
  "inv_movements",
  {
    id: serial("id").primaryKey(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => invDocuments.id),
    itemId: uuid("item_id")
      .notNull()
      .references(() => invItems.id),
    batchId: uuid("batch_id").references(() => invBatches.id),
    qtyIn: qty("qty_in").notNull().default("0"),
    qtyOut: qty("qty_out").notNull().default("0"),
    unitCost: rate("unit_cost").notNull(),
    /** Value in paise (positive), saved at the moment of the movement so job costs never change later. */
    value: bigint("value", { mode: "number" }).notNull(),
    reasonId: uuid("reason_id").references(() => invAdjustReasons.id),
    /** Opening stock (Adjust stock > Opening stock): shown as "Opening stock" in history. */
    isOpening: boolean("is_opening").notNull().default(false),
    note: text("note"),
    /** The item's stock right after this movement (the running balance). */
    balanceAfter: qty("balance_after").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("inv_movements_item_idx").on(t.itemId, t.id), index("inv_movements_document_idx").on(t.documentId)],
);

/** Materials list of a rate-card service: how much of an item per billing unit (suggestions only). */
export const invServiceMaterials = pgTable(
  "inv_service_materials",
  {
    serviceId: integer("service_id")
      .notNull()
      .references(() => services.id),
    itemId: uuid("item_id")
      .notNull()
      .references(() => invItems.id),
    qtyPerUnit: rate("qty_per_unit").notNull(),
  },
  (t) => [primaryKey({ columns: [t.serviceId, t.itemId] })],
);

export const invCounts = pgTable("inv_counts", {
  id: uuid("id").primaryKey().defaultRandom(),
  countNo: text("count_no").notNull(),
  status: invCountStatusEnum("status").notNull().default("IN_PROGRESS"),
  filter: jsonb("filter").$type<Record<string, unknown>>(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  adjustmentDocId: uuid("adjustment_doc_id").references(() => invDocuments.id),
  doneBy: uuid("done_by").references(() => teamMembers.id),
});

export const invCountLines = pgTable(
  "inv_count_lines",
  {
    id: serial("id").primaryKey(),
    countId: uuid("count_id")
      .notNull()
      .references(() => invCounts.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => invItems.id),
    batchId: uuid("batch_id").references(() => invBatches.id),
    systemQty: qty("system_qty").notNull(),
    countedQty: qty("counted_qty"),
    countedAt: timestamp("counted_at", { withTimezone: true }),
  },
  (t) => [index("inv_count_lines_count_idx").on(t.countId)],
);

export const invReorderSends = pgTable("inv_reorder_sends", {
  id: uuid("id").primaryKey().defaultRandom(),
  supplierId: uuid("supplier_id").references(() => invSuppliers.id),
  items: jsonb("items").$type<{ itemId: string; name: string; qty: string; unit: string }[]>().notNull(),
  method: text("method").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  doneBy: uuid("done_by").references(() => teamMembers.id),
});

// ---------------------------------------------------------------------------
// Module 6: Planning (machines, jobs, bookings)
// ---------------------------------------------------------------------------

export const machines = pgTable(
  "machines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    deptCode: text("dept_code")
      .notNull()
      .references(() => departments.code),
    location: text("location"),
    makeModel: text("make_model"),
    keySpecs: text("key_specs"),
    testStandards: text("test_standards"),
    nablAccredited: boolean("nabl_accredited").notNull().default(false),
    status: machineStatusEnum("status").notNull().default("AVAILABLE"),
    /** "Jobs at the same time". */
    parallelJobs: integer("parallel_jobs").notNull().default(1),
    /** "Runs day and night": ignores working hours and holidays. */
    runsNonstop: boolean("runs_nonstop").notNull().default(false),
    notes: text("notes"),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (t) => [uniqueIndex("machines_code_idx").on(t.code), index("machines_dept_idx").on(t.deptCode)],
);

export const machineServices = pgTable(
  "machine_services",
  {
    machineId: uuid("machine_id")
      .notNull()
      .references(() => machines.id, { onDelete: "cascade" }),
    serviceId: integer("service_id")
      .notNull()
      .references(() => services.id),
  },
  (t) => [primaryKey({ columns: [t.machineId, t.serviceId] })],
);

export const machineBlocks = pgTable(
  "machine_blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    machineId: uuid("machine_id")
      .notNull()
      .references(() => machines.id, { onDelete: "cascade" }),
    type: machineBlockTypeEnum("type").notNull(),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    note: text("note"),
    invDocumentId: uuid("inv_document_id").references(() => invDocuments.id),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("machine_blocks_machine_idx").on(t.machineId, t.startAt)],
);

export const holidays = pgTable("holidays", {
  id: serial("id").primaryKey(),
  date: date("date").notNull().unique(),
  name: text("name").notNull(),
});

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id")
      .notNull()
      .unique()
      .references(() => tickets.id),
    status: jobStatusEnum("status").notNull().default("TO_PLAN"),
    hoursNeeded: numeric("hours_needed", { precision: 10, scale: 2 }),
    promisedDate: date("promised_date"),
    priority: jobPriorityEnum("priority").notNull().default("NORMAL"),
    operatorId: uuid("operator_id").references(() => teamMembers.id),
    instructions: text("instructions"),
    holdReason: text("hold_reason"),
    doneAt: timestamp("done_at", { withTimezone: true }),
    doneNote: text("done_note"),
    qtyDone: text("qty_done"),
    handedOverAt: date("handed_over_at"),
    handedOverTo: text("handed_over_to"),
    /** Backfill: the ticket was already in Billing or Payment follow-up. "Check if work is done" until it is marked done. */
    checkWorkDone: boolean("check_work_done").notNull().default(false),
    ...timestamps,
  },
  (t) => [index("jobs_status_idx").on(t.status)],
);

export const jobFiles = pgTable(
  "job_files",
  {
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id),
  },
  (t) => [primaryKey({ columns: [t.jobId, t.fileId] })],
);

export const jobBookings = pgTable(
  "job_bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id),
    machineId: uuid("machine_id")
      .notNull()
      .references(() => machines.id),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    /** Working hours booked (the end is worked out over working hours, or non-stop). */
    hours: numeric("hours", { precision: 10, scale: 2 }).notNull(),
    operatorId: uuid("operator_id").references(() => teamMembers.id),
    isTentative: boolean("is_tentative").notNull().default(false),
    holdUntil: date("hold_until"),
    note: text("note"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (t) => [index("job_bookings_machine_idx").on(t.machineId, t.startAt), index("job_bookings_job_idx").on(t.jobId)],
);

export const jobTimeLogs = pgTable(
  "job_time_logs",
  {
    id: serial("id").primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id),
    bookingId: uuid("booking_id").references(() => jobBookings.id),
    machineId: uuid("machine_id").references(() => machines.id),
    operatorId: uuid("operator_id").references(() => teamMembers.id),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    /** Why the running period ended with a pause (empty when it ended with Done). */
    pauseReason: text("pause_reason"),
  },
  (t) => [index("job_time_logs_job_idx").on(t.jobId)],
);

export const jobEvents = pgTable(
  "job_events",
  {
    id: serial("id").primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id),
    type: text("type").notNull(),
    message: text("message").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>(),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("job_events_job_idx").on(t.jobId, t.createdAt)],
);

export type Machine = typeof machines.$inferSelect;
export type MachineStatus = (typeof machineStatusEnum.enumValues)[number];
export type MachineBlockType = (typeof machineBlockTypeEnum.enumValues)[number];
export type Job = typeof jobs.$inferSelect;
export type JobStatus = (typeof jobStatusEnum.enumValues)[number];
export type JobBooking = typeof jobBookings.$inferSelect;

export type InvItem = typeof invItems.$inferSelect;
export type InvSupplier = typeof invSuppliers.$inferSelect;
export type InvBatch = typeof invBatches.$inferSelect;
export type InvDocument = typeof invDocuments.$inferSelect;
export type InvMovement = typeof invMovements.$inferSelect;
export type InvDocType = (typeof invDocTypeEnum.enumValues)[number];

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
export type CrmStage = typeof crmStages.$inferSelect;
export type CrmStageType = (typeof crmStageTypeEnum.enumValues)[number];
export type CrmActivityType = (typeof crmActivityTypeEnum.enumValues)[number];
export type Lead = typeof leads.$inferSelect;
export type CrmActivity = typeof crmActivities.$inferSelect;
export type LeadEvent = typeof leadEvents.$inferSelect;
export type TeamMember = typeof teamMembers.$inferSelect;

// ---- Module 7: users, roles and sign-in ----------------------------------------------------------
// Better Auth's own tables (its models user / session / account / verification), named auth_* so
// they never clash with ours. Ids are text because Better Auth makes them.

export const authUsers = pgTable("auth_users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  // Added by Better Auth's admin plugin.
  role: text("role"),
  banned: boolean("banned").default(false),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires", { withTimezone: true }),
});

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    impersonatedBy: text("impersonated_by"),
  },
  (t) => [index("auth_sessions_user_idx").on(t.userId)],
);

export const authAccounts = pgTable(
  "auth_accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("auth_accounts_user_idx").on(t.userId)],
);

export const authVerifications = pgTable("auth_verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * People who use the app (or are assigned work). Linked 1:1 to team_members, so every existing
 * assigned_to / done_by / operator_id keeps working. Name-only people have no auth_user_id.
 */
export const appUsers = pgTable("app_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  authUserId: text("auth_user_id")
    .unique()
    .references(() => authUsers.id),
  teamMemberId: uuid("team_member_id")
    .notNull()
    .unique()
    .references(() => teamMembers.id),
  fullName: text("full_name").notNull(),
  email: text("email").unique(),
  mobile: text("mobile"),
  canSignIn: boolean("can_sign_in").notNull().default(false),
  allDepartments: boolean("all_departments").notNull().default(true),
  pinHash: text("pin_hash"),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  /** Demo accounts ("Try it as..."): only exist when DEMO_MODE is true. */
  isDemo: boolean("is_demo").notNull().default(false),
  deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
  lastSignInAt: timestamp("last_sign_in_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const userDepartments = pgTable(
  "user_departments",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    deptCode: text("dept_code")
      .notNull()
      .references(() => departments.code),
  },
  (t) => [primaryKey({ columns: [t.userId, t.deptCode] })],
);

export const roles = pgTable("roles", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description").notNull().default(""),
  /** The built-in roles (Admin, Manager, ...). Admin can't lose Users or Settings. */
  isSystem: boolean("is_system").notNull().default(false),
  /** "Can only act on their own departments". */
  scopeOwnDepartments: boolean("scope_own_departments").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: integer("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permission: text("permission").notNull(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permission] })],
);

export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    roleId: integer("role_id")
      .notNull()
      .references(() => roles.id),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId] })],
);

export const sharedDevices = pgTable("shared_devices", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  deptCodes: text("dept_codes").array().notNull().default(sql`'{}'::text[]`),
  tokenHash: text("token_hash").notNull().unique(),
  createdBy: uuid("created_by").references(() => appUsers.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const activityLog = pgTable(
  "activity_log",
  {
    id: serial("id").primaryKey(),
    userId: uuid("user_id").references(() => appUsers.id),
    onBehalfOfUserId: uuid("on_behalf_of_user_id").references(() => appUsers.id),
    area: text("area").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    summary: text("summary").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("activity_log_created_idx").on(t.createdAt), index("activity_log_user_idx").on(t.userId, t.createdAt)],
);

export const signInAttempts = pgTable(
  "sign_in_attempts",
  {
    id: serial("id").primaryKey(),
    email: text("email"),
    ip: text("ip"),
    success: boolean("success").notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sign_in_attempts_email_idx").on(t.email, t.createdAt), index("sign_in_attempts_ip_idx").on(t.ip, t.createdAt)],
);

export type AppUser = typeof appUsers.$inferSelect;
export type Role = typeof roles.$inferSelect;
