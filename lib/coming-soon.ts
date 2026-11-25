/**
 * "Coming soon" modules: shown in the sidebar and on /soon/<slug> so people can see the full plan.
 * Nothing here is a working feature and nothing touches the database.
 */
import { Building2, FileCheck2, FlaskConical, Globe, GraduationCap, LayoutDashboard, Lightbulb, RefreshCw, ShoppingCart, Wrench, type LucideIcon } from "lucide-react";

/** The shape of the faded sketch on the module's page (grey placeholders only, no data). */
export type SketchKind = "register" | "calendar" | "approvals" | "dashboard" | "portal" | "sync" | "documents" | "batches" | "venues" | "milestones";

export interface ComingSoonModule {
  slug: string;
  name: string;
  icon: LucideIcon;
  summary: string;
  bullets: string[];
  /** Modules it will work with: live ones link to their pages; coming-soon ones to their /soon page (and show "Soon"). */
  worksWith: { label: string; href: string }[];
  sketch: SketchKind;
}

const ORDERS = { label: "Orders & Billing", href: "/orders" };
const PLANNING = { label: "Planning", href: "/planning" };
const INVENTORY = { label: "Inventory", href: "/inventory" };
const QUOTATIONS = { label: "Quotations", href: "/quotations" };
const CRM = { label: "CRM", href: "/crm" };
const CUSTOMERS = { label: "Customers", href: "/customers" };
/** Another coming-soon module, by its slug. */
const soon = (slug: string, label: string) => ({ label, href: `/soon/${slug}` });

export const COMING_SOON: ComingSoonModule[] = [
  {
    slug: "test-reports",
    name: "Test Reports",
    icon: FlaskConical,
    summary: "Log every sample and issue NABL-ready test reports.",
    bullets: [
      "Register samples on arrival with a label and QR code",
      "Record results against the test standard (ASTM, ISO)",
      "Review and approve before release",
      "PDF report with a QR code customers can verify",
      "Track samples returned or disposed of",
    ],
    worksWith: [ORDERS, PLANNING],
    sketch: "register",
  },
  {
    slug: "maintenance",
    name: "Maintenance & Calibration",
    icon: Wrench,
    summary: "Keep every machine running and every test valid.",
    bullets: [
      "Preventive maintenance schedules",
      "Breakdown log with downtime and cause",
      "Calibration due dates with certificates",
      "Reminders before anything is overdue",
      "Spares used from Inventory",
    ],
    worksWith: [PLANNING, INVENTORY],
    sketch: "calendar",
  },
  {
    slug: "purchase",
    name: "Purchase & Approvals",
    icon: ShoppingCart,
    summary: "From reorder list to approved supplier order.",
    bullets: [
      "Turn the Reorder list into purchase orders",
      "Approval limits (e.g. above ₹50,000 to the Director)",
      "Receive stock against the PO",
      "Supplier bills and payment due dates",
    ],
    worksWith: [INVENTORY],
    sketch: "approvals",
  },
  {
    slug: "dashboard",
    name: "Management Dashboard",
    icon: LayoutDashboard,
    summary: "The whole institute on one screen.",
    bullets: [
      "Revenue by department and month",
      "Money owed and overdue",
      "Machine use and work waiting",
      "Enquiry-to-order rate",
      "One-click monthly report for the board",
    ],
    worksWith: [{ label: "All modules", href: "/" }],
    sketch: "dashboard",
  },
  {
    slug: "customer-portal",
    name: "Customer Portal",
    icon: Globe,
    summary: "Customers serve themselves, 24x7.",
    bullets: ["Accept quotations online", "Upload POs and drawings", "Track job status live", "Download test reports and invoices"],
    worksWith: [QUOTATIONS, ORDERS, PLANNING],
    sketch: "portal",
  },
  {
    slug: "tally-sync",
    name: "Tally Sync",
    icon: RefreshCw,
    summary: "No double entry between the ERP and Tally.",
    bullets: ["Invoices created in TallyPrime automatically", "Payments synced back", "Ledger mapping in Settings"],
    worksWith: [ORDERS],
    sketch: "sync",
  },
  {
    slug: "documents",
    name: "Documents & NABL",
    icon: FileCheck2,
    summary: "Audit-ready, always.",
    bullets: ["SOPs and forms with version control", "Who read and approved each document", "Audit checklists and findings", "Ready for NABL / ISO 17025 audits"],
    worksWith: [soon("test-reports", "Test Reports"), soon("maintenance", "Maintenance & Calibration")],
    sketch: "documents",
  },
  {
    slug: "training",
    name: "Training Programmes",
    icon: GraduationCap,
    summary: "Run courses from registration to certificate.",
    bullets: ["Course calendar and batches", "Online registration and fees", "QR attendance", "Certificates generated automatically"],
    worksWith: [CRM, CUSTOMERS],
    sketch: "batches",
  },
  {
    slug: "venue-booking",
    name: "Venue Booking",
    icon: Building2,
    summary: "Book the Exhibition Centre, Auditorium and Seminar Hall.",
    bullets: ["Availability calendar for each venue", "Booking requests with rates and quotation", "Advance payment and confirmation", "Uses the same booking engine as machines"],
    worksWith: [QUOTATIONS, PLANNING],
    sketch: "venues",
  },
  {
    slug: "rnd-projects",
    name: "R&D Projects",
    icon: Lightbulb,
    summary: "Track research from idea to outcome.",
    bullets: ["Projects with milestones and owners", "Budget vs spend", "Grant reporting", "Papers, patents and outcomes"],
    worksWith: [INVENTORY, PLANNING],
    sketch: "milestones",
  },
];

/** Is this "Works with" link another coming-soon module? (It then shows the "Soon" badge.) */
export const isSoonHref = (href: string) => href.startsWith("/soon/");

export const comingSoonBySlug = (slug: string) => COMING_SOON.find((m) => m.slug === slug);
