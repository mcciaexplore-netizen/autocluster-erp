/**
 * Pipeline stages: preset colours, the default stages, and the rules every
 * change to the stages must follow. Pure functions, shared by the server and the screens.
 */

export type StageType = "OPEN" | "WON" | "LOST";

/** The 8 preset colours a stage can have. `bar` is the column's colour bar, `pill` the stage label. */
export const STAGE_COLORS = {
  grey: { label: "Grey", bar: "bg-slate-400", pill: "bg-slate-100 text-slate-700 border-slate-200", dot: "bg-slate-400" },
  blue: { label: "Blue", bar: "bg-blue-500", pill: "bg-blue-50 text-blue-800 border-blue-200", dot: "bg-blue-500" },
  amber: { label: "Amber", bar: "bg-amber-500", pill: "bg-amber-50 text-amber-800 border-amber-200", dot: "bg-amber-500" },
  green: { label: "Green", bar: "bg-emerald-500", pill: "bg-emerald-50 text-emerald-800 border-emerald-200", dot: "bg-emerald-500" },
  red: { label: "Red", bar: "bg-red-500", pill: "bg-red-50 text-red-700 border-red-200", dot: "bg-red-500" },
  purple: { label: "Purple", bar: "bg-violet-500", pill: "bg-violet-50 text-violet-800 border-violet-200", dot: "bg-violet-500" },
  teal: { label: "Teal", bar: "bg-teal-500", pill: "bg-teal-50 text-teal-800 border-teal-200", dot: "bg-teal-500" },
  pink: { label: "Pink", bar: "bg-pink-500", pill: "bg-pink-50 text-pink-800 border-pink-200", dot: "bg-pink-500" },
} as const;
export type StageColor = keyof typeof STAGE_COLORS;
export const STAGE_COLOR_KEYS = Object.keys(STAGE_COLORS) as StageColor[];
export const stageColor = (c: string) => STAGE_COLORS[(c in STAGE_COLORS ? c : "grey") as StageColor];

export const DEFAULT_STAGES: { name: string; type: StageType; probability: number; color: StageColor }[] = [
  { name: "New", type: "OPEN", probability: 10, color: "grey" },
  { name: "Contacted", type: "OPEN", probability: 30, color: "blue" },
  { name: "Negotiation", type: "OPEN", probability: 60, color: "amber" },
  { name: "Won", type: "WON", probability: 100, color: "green" },
  { name: "Lost", type: "LOST", probability: 0, color: "red" },
];

/** The stage new quotations move an enquiry to, until Settings says otherwise. */
export const DEFAULT_QUOTE_MOVE_STAGE = "Negotiation";

export const DEFAULT_SOURCES = ["Website", "Phone call", "Walk-in", "Email", "WhatsApp", "Referral", "Exhibition / Event", "MCCIA", "Other"];
export const DEFAULT_LOST_REASONS = [
  "Price too high",
  "Chose another provider",
  "No budget",
  "Not interested now",
  "No response",
  "Service not available",
  "Other",
];
export const DEFAULT_TAGS = ["Urgent", "Repeat customer", "Government", "Startup"];

export const STAGE_RULES_HELP =
  "There is always one Won stage and one Lost stage. You can rename, recolour and reorder them, but not delete them. Won and Lost always stay at the right.";

/** A stage list in board order. */
type StageLike = { id: string; type: StageType; name: string };

/**
 * Checks a stage list (in board order) follows the rules. Returns a plain-words problem, or null.
 * - exactly one Won and one Lost stage
 * - at least one open stage
 * - Won and Lost stay to the right of every open stage
 */
export function stageOrderProblem(stages: StageLike[]): string | null {
  const won = stages.filter((s) => s.type === "WON").length;
  const lost = stages.filter((s) => s.type === "LOST").length;
  if (won !== 1) return "There must be exactly one Won stage.";
  if (lost !== 1) return "There must be exactly one Lost stage.";
  if (!stages.some((s) => s.type === "OPEN")) return "There must be at least one open stage.";
  const firstClosed = stages.findIndex((s) => s.type !== "OPEN");
  if (stages.slice(firstClosed).some((s) => s.type === "OPEN")) return "Won and Lost must stay to the right of the open stages.";
  return null;
}

export function stageNameProblem(name: string, others: { name: string }[]): string | null {
  const n = name.trim();
  if (!n) return "Please enter a stage name.";
  if (n.length > 40) return "Please keep the stage name under 40 characters.";
  if (others.some((o) => o.name.trim().toLowerCase() === n.toLowerCase())) return `There is already a stage called "${n}".`;
  return null;
}
