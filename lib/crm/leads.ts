/**
 * Enquiry helpers shared by the board, the list view and the Excel export.
 * Pure functions only (no database), so they run on the server and in the browser.
 */
import { addDays, daysBetween, todayInIndia } from "@/lib/tickets";

export const ACTIVITY_TYPES = {
  CALL: "Call",
  MEETING: "Meeting",
  EMAIL: "Email",
  WHATSAPP: "WhatsApp",
  SITE_VISIT: "Site visit",
  FOLLOW_UP: "Follow-up",
} as const;
export type ActivityType = keyof typeof ACTIVITY_TYPES;

/** planned = green, today = amber, overdue = red, none = grey "+". Uses India time. */
export type ActivityStatus = "overdue" | "today" | "planned" | "none";

export function activityStatus(dueDate: string | null | undefined, today: string = todayInIndia()): ActivityStatus {
  if (!dueDate) return "none";
  const d = daysBetween(today, dueDate);
  return d < 0 ? "overdue" : d === 0 ? "today" : "planned";
}

export function activityDueLabel(dueDate: string, today: string = todayInIndia()): string {
  const d = daysBetween(today, dueDate);
  if (d === 0) return "Due today";
  if (d === 1) return "Due tomorrow";
  if (d > 1) return `Due in ${d} days`;
  return `Overdue by ${-d} ${d === -1 ? "day" : "days"}`;
}

export function daysInStageLabel(days: number): string {
  if (days === 0) return "Moved here today";
  return `${days} ${days === 1 ? "day" : "days"} in this stage`;
}

export const PRIORITY_LABELS = ["No priority", "Low", "Medium", "High"] as const;

/** The fields filters and sorting need. */
export interface FilterableLead {
  leadNo: string;
  title: string;
  companyName: string;
  contactName: string;
  phone: string | null;
  email: string | null;
  stageId: string;
  priority: number;
  expectedValuePaise: number | null;
  expectedCloseDate: string | null;
  sourceId: string;
  assignedToId: string | null;
  depts: string[];
  tagIds: string[];
  nextActivityDate: string | null;
  createdAt: string;
  stageType: "OPEN" | "WON" | "LOST";
  wonAt: string | null;
}

export const CLOSE_FILTERS = {
  thisMonth: "This month",
  nextMonth: "Next month",
  passed: "Date has passed",
  none: "No date set",
} as const;
export type CloseFilter = keyof typeof CLOSE_FILTERS;

export const ACTIVITY_FILTERS = { overdue: "Overdue", today: "Today", upcoming: "Upcoming", none: "None planned" } as const;
export type ActivityFilter = keyof typeof ACTIVITY_FILTERS;

export const SORTS = { priority: "Priority", activity: "Next activity", value: "Expected value", newest: "Newest" } as const;
export type SortKey = keyof typeof SORTS;

export interface LeadFilters {
  q?: string;
  assigned?: string; // team member id, or "none"
  source?: string;
  dept?: string;
  priority?: string; // "0".."3"
  tag?: string;
  activity?: ActivityFilter;
  close?: CloseFilter;
  stage?: string;
  /** Home page cards: "thisMonth" */
  created?: "thisMonth";
  state?: "open" | "won" | "lost";
  won?: "thisMonth";
}

/** Labels for the home-card filters, shown as removable chips on the board and list. */
export const CARD_FILTERS = {
  created: { thisMonth: "New this month" },
  state: { open: "Open enquiries", won: "Won", lost: "Lost" },
  won: { thisMonth: "Won this month" },
} as const;

/** Reads filters from the page address (?q=&assigned=...). */
export function filtersFromParams(p: { get(k: string): string | null }): LeadFilters {
  const pick = <T extends string>(k: string, allowed?: readonly string[]) => {
    const v = p.get(k)?.trim();
    return v && (!allowed || allowed.includes(v)) ? (v as T) : undefined;
  };
  return {
    q: pick("q"),
    assigned: pick("assigned"),
    source: pick("source"),
    dept: pick("dept"),
    priority: pick("priority", ["0", "1", "2", "3"]),
    tag: pick("tag"),
    activity: pick<ActivityFilter>("activity", Object.keys(ACTIVITY_FILTERS)),
    close: pick<CloseFilter>("close", Object.keys(CLOSE_FILTERS)),
    stage: pick("stage"),
    created: pick<"thisMonth">("created", ["thisMonth"]),
    state: pick<"open" | "won" | "lost">("state", ["open", "won", "lost"]),
    won: pick<"thisMonth">("won", ["thisMonth"]),
  };
}

const monthOf = (iso: string) => iso.slice(0, 7);
function nextMonthOf(today: string) {
  const y = +today.slice(0, 4);
  const m = +today.slice(5, 7);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** The India-time month (YYYY-MM) of a timestamp. */
const indiaMonth = (iso: string) => todayInIndia(new Date(iso)).slice(0, 7);

export function matchesFilters(l: FilterableLead, f: LeadFilters, today: string = todayInIndia()): boolean {
  if (f.stage && l.stageId !== f.stage) return false;
  if (f.state && l.stageType !== f.state.toUpperCase()) return false;
  if (f.created === "thisMonth" && indiaMonth(l.createdAt) !== monthOf(today)) return false;
  if (f.won === "thisMonth" && !(l.stageType === "WON" && l.wonAt && indiaMonth(l.wonAt) === monthOf(today))) return false;
  if (f.assigned && (f.assigned === "none" ? l.assignedToId : l.assignedToId !== f.assigned)) return false;
  if (f.source && l.sourceId !== f.source) return false;
  if (f.dept && !l.depts.includes(f.dept)) return false;
  if (f.priority && l.priority !== Number(f.priority)) return false;
  if (f.tag && !l.tagIds.includes(f.tag)) return false;
  if (f.activity) {
    const st = activityStatus(l.nextActivityDate, today);
    const want = f.activity === "upcoming" ? "planned" : f.activity;
    if (st !== want) return false;
  }
  if (f.close) {
    const d = l.expectedCloseDate;
    if (f.close === "none" ? d : !d) return false;
    if (d && f.close === "thisMonth" && monthOf(d) !== monthOf(today)) return false;
    if (d && f.close === "nextMonth" && monthOf(d) !== nextMonthOf(today)) return false;
    if (d && f.close === "passed" && !(d < today)) return false;
  }
  if (f.q) {
    const q = f.q.toLowerCase();
    const digits = q.replace(/\D/g, "");
    const hay = [l.leadNo, l.title, l.companyName, l.contactName, l.email].join(" ").toLowerCase();
    const phoneHit = digits.length >= 3 && (l.phone ?? "").includes(digits);
    if (!hay.includes(q) && !phoneHit) return false;
  }
  return true;
}

export function sortLeads<T extends FilterableLead>(leads: T[], key: SortKey = "priority"): T[] {
  const far = "9999-12-31";
  const byNewest = (a: T, b: T) => b.createdAt.localeCompare(a.createdAt);
  const cmp: Record<SortKey, (a: T, b: T) => number> = {
    priority: (a, b) => b.priority - a.priority || byNewest(a, b),
    activity: (a, b) => (a.nextActivityDate ?? far).localeCompare(b.nextActivityDate ?? far) || b.priority - a.priority,
    value: (a, b) => (b.expectedValuePaise ?? -1) - (a.expectedValuePaise ?? -1) || byNewest(a, b),
    newest: byNewest,
  };
  return [...leads].sort(cmp[key]);
}

export { addDays, todayInIndia };
