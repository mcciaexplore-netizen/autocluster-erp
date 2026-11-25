/**
 * "Coming soon" modules: shown in the sidebar and on /soon/<slug> so people can see the full plan.
 * Nothing here is a working feature and nothing touches the database.
 */
import { FileCheck2, FlaskConical, Globe, LayoutDashboard, RefreshCw, ShoppingCart, Wrench, type LucideIcon } from "lucide-react";

/** The shape of the faded sketch on the module's page (grey placeholders only, no data). */
export type SketchKind = "register" | "calendar" | "approvals" | "dashboard" | "portal" | "sync" | "documents";

export interface ComingSoonModule {
  slug: string;
  name: string;
  icon: LucideIcon;
  summary: string;
  bullets: string[];
  /** Existing modules (or other coming-soon ones) it will work with. */
  worksWith: { label: string; href: string }[];
  sketch: SketchKind;
}

const ORDERS = { label: "Orders & Billing", href: "/orders" };
const PLANNING = { label: "Planning", href: "/planning" };
const INVENTORY = { label: "Inventory", href: "/inventory" };
const QUOTATIONS = { label: "Quotations", href: "/quotations" };

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
    // The message was cut off after "Works with: Test": Test Reports assumed, to confirm.
    worksWith: [{ label: "Test Reports", href: "/soon/test-reports" }],
    sketch: "documents",
  },
];

export const comingSoonBySlug = (slug: string) => COMING_SOON.find((m) => m.slug === slug);
