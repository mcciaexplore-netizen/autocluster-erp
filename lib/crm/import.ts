/**
 * Importing enquiries from Excel: the columns, and checking each row in plain words.
 * Pure (no database, no Excel library), so it can be tested and reused.
 * Sources, stages, team members and tags must match existing names; unknown values are
 * reported as problems and never created.
 */
import { MOBILE_REGEX } from "@/lib/india";
import { parseRupees } from "@/lib/money-input";
import { EMAIL_RE, normalizeMobile } from "./contact";

export const IMPORT_COLUMNS = [
  { key: "title", header: "Enquiry title", required: true, width: 36, example: "3D printing of 20 prototype parts" },
  { key: "companyName", header: "Company", required: true, width: 30, example: "Kalyani Tooling Pvt Ltd" },
  { key: "contactName", header: "Contact person", required: true, width: 22, example: "Neha Patil" },
  { key: "designation", header: "Designation", required: false, width: 18, example: "Purchase Manager" },
  { key: "phone", header: "Mobile", required: false, width: 15, example: "9822012345" },
  { key: "email", header: "Email", required: false, width: 28, example: "neha@kalyani.example" },
  { key: "city", header: "City", required: false, width: 14, example: "Pune" },
  { key: "source", header: "Source", required: true, width: 18, example: "Website" },
  { key: "stage", header: "Stage", required: false, width: 14, example: "New" },
  { key: "departments", header: "Departments", required: false, width: 16, example: "RPT, RPL" },
  { key: "expectedValue", header: "Expected value (₹)", required: false, width: 16, example: "50000" },
  { key: "expectedCloseDate", header: "Expected close date", required: false, width: 18, example: "31/12/2026" },
  { key: "priority", header: "Priority (0-3)", required: false, width: 12, example: "2" },
  { key: "assignedTo", header: "Assigned to", required: false, width: 18, example: "" },
  { key: "tags", header: "Tags", required: false, width: 18, example: "Urgent" },
  { key: "category", header: "Company category", required: false, width: 16, example: "MSME" },
  { key: "isMcciaMember", header: "MCCIA member (Yes/No)", required: false, width: 14, example: "Yes" },
  { key: "mcciaMembershipId", header: "Membership ID", required: false, width: 16, example: "MCCIA/2024/0123" },
  { key: "notes", header: "Notes", required: false, width: 40, example: "Needs ABS-like resin. Drawings to follow by email." },
] as const;

export type ImportKey = (typeof IMPORT_COLUMNS)[number]["key"];
export type RawRow = Partial<Record<ImportKey, string>>;
export const EXAMPLE_TITLE = IMPORT_COLUMNS[0].example;
export const MAX_IMPORT_ROWS = 500;
/** Kept under the 1 MB limit for uploads to the server. A 500-row file is usually under 100 KB. */
export const MAX_IMPORT_BYTES = 900 * 1024;
export const IMPORT_TOO_BIG = "The file is larger than 900 KB. Please remove any pictures or extra sheets, or split it into smaller files.";

export interface ImportLists {
  sources: { id: string; name: string }[];
  stages: { id: string; name: string; type: "OPEN" | "WON" | "LOST" }[];
  team: { id: string; name: string }[];
  tags: { id: string; name: string }[];
  departments: { code: string; name: string }[];
}

/** What the writer needs for one row (same shape as LeadInput). */
export interface ImportInput {
  title: string;
  companyName: string;
  contactName: string;
  designation: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  sourceId: string;
  stageId: string;
  deptCodes: string[];
  expectedValuePaise: number | null;
  expectedCloseDate: string | null;
  priority: number;
  assignedTo: string | null;
  tagIds: string[];
  category: "OEM" | "TIER1" | "TIER2" | "MSME" | null;
  isMcciaMember: boolean | null;
  mcciaMembershipId: string | null;
  notes: string | null;
}

export interface CheckedRow {
  rowNo: number;
  raw: RawRow;
  input: ImportInput | null;
  problems: string[];
}

/** Matches a header cell to a column, ignoring case, spaces, "*" and brackets. */
export function columnForHeader(header: string): ImportKey | null {
  const norm = (s: string) => s.toLowerCase().replace(/\(.*?\)|\*/g, "").replace(/[^a-z]/g, "");
  const h = norm(header);
  if (!h) return null;
  const hit = IMPORT_COLUMNS.find((c) => norm(c.header) === h || c.key.toLowerCase() === h);
  if (hit) return hit.key;
  const aliases: Record<string, ImportKey> = { title: "title", enquiry: "title", company: "companyName", companyname: "companyName", contact: "contactName", name: "contactName", phone: "phone", mobileno: "phone", mobilenumber: "phone", department: "departments", value: "expectedValue", closedate: "expectedCloseDate", assigned: "assignedTo", tag: "tags", category: "category", mcciamember: "isMcciaMember" };
  return aliases[h] ?? null;
}

const clean = (v: string | undefined) => {
  const t = (v ?? "").trim().replace(/\s+/g, " ");
  return t || null;
};
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const list = (v: string | null) =>
  (v ?? "")
    .split(/[,;\n]+/)
    .map((x) => x.trim())
    .filter(Boolean);
const names = (items: { name: string }[], max = 12) => {
  const n = items.map((i) => i.name);
  return n.length > max ? `${n.slice(0, max).join(", ")} and ${n.length - max} more` : n.join(", ");
};

/** "31/12/2026", "31-12-2026", "2026-12-31" or an Excel date -> "2026-12-31". Null when it isn't a real date. */
export function parseImportDate(v: string | null): string | null {
  if (!v) return null;
  const t = v.trim();
  let y: number, m: number, d: number;
  let r = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/);
  if (r) [y, m, d] = [+r[1], +r[2], +r[3]];
  else if ((r = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) [d, m, y] = [+r[1], +r[2], +r[3]];
  else if (/^\d{5}(\.\d+)?$/.test(t)) {
    // Excel serial date (days since 1899-12-30)
    const dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(+t) * 86_400_000);
    [y, m, d] = [dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()];
  } else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d || y < 2000 || y > 2100) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const CATEGORY: Record<string, ImportInput["category"]> = { oem: "OEM", tier1: "TIER1", "tier 1": "TIER1", tier2: "TIER2", "tier 2": "TIER2", msme: "MSME" };

/** Checks one row. Every problem is a full plain-words sentence starting "Row N:". */
export function checkImportRow(raw: RawRow, rowNo: number, lists: ImportLists): CheckedRow {
  const p: string[] = [];
  const bad = (msg: string) => p.push(`Row ${rowNo}: ${msg}`);
  const v = (k: ImportKey) => clean(raw[k]);

  const title = v("title");
  if (!title) bad("the enquiry title is missing.");
  else if (title.length > 200) bad("the enquiry title is too long (keep it under 200 characters).");
  const companyName = v("companyName");
  if (!companyName) bad("the company name is missing.");
  const contactName = v("contactName");
  if (!contactName) bad("the contact person is missing.");

  const phoneText = v("phone");
  const phone = normalizeMobile(phoneText);
  if (phoneText && (!phone || !MOBILE_REGEX.test(phone))) bad("mobile number should have 10 digits, starting with 6, 7, 8 or 9.");
  const email = v("email")?.toLowerCase() ?? null;
  if (email && !EMAIL_RE.test(email)) bad(`email “${email}” doesn't look right, e.g. name@company.com.`);
  if (!phoneText && !email) bad("add a mobile number or an email address.");

  const sourceName = v("source");
  const source = sourceName ? lists.sources.find((s) => same(s.name, sourceName)) : undefined;
  if (!sourceName) bad(`the source is missing. Use one of: ${names(lists.sources)}.`);
  else if (!source) bad(`source “${sourceName}” isn't in the list. Use one of: ${names(lists.sources)}.`);

  const stageName = v("stage");
  const firstOpen = lists.stages.find((s) => s.type === "OPEN");
  let stage = stageName ? lists.stages.find((s) => same(s.name, stageName)) : firstOpen;
  if (stageName && !stage) bad(`stage “${stageName}” isn't on the board. Use one of: ${names(lists.stages.filter((s) => s.type !== "LOST"))}.`);
  else if (stage?.type === "LOST") {
    bad(`stage “${stage.name}” can't be imported, because a lost reason is needed. Import it into an open stage, then mark it as lost.`);
    stage = undefined;
  }

  const deptCodes: string[] = [];
  for (const d of list(v("departments"))) {
    const hit = lists.departments.find((x) => same(x.code, d) || same(x.name, d));
    if (hit) deptCodes.push(hit.code);
    else bad(`department “${d}” isn't known. Use ${lists.departments.map((x) => x.code).join(", ")}.`);
  }

  const valueText = v("expectedValue");
  const value = valueText ? parseRupees(valueText) : null;
  if (valueText && value == null) bad(`expected value “${valueText}” should be an amount in rupees, e.g. 50000.`);

  const closeText = v("expectedCloseDate");
  const close = parseImportDate(closeText);
  if (closeText && !close) bad(`expected close date “${closeText}” should be a date, e.g. 31/12/2026.`);

  const prText = v("priority");
  let priority = 0;
  if (prText) {
    const stars = /^★+$/.test(prText) ? prText.length : Number(prText);
    if (!Number.isInteger(stars) || stars < 0 || stars > 3) bad(`priority “${prText}” should be 0, 1, 2 or 3.`);
    else priority = stars;
  }

  const who = v("assignedTo");
  const member = who ? lists.team.find((m) => same(m.name, who)) : undefined;
  if (who && !member) bad(`“${who}” isn't a team member. Add them in Settings > CRM lists first, or leave it empty.`);

  const tagIds: string[] = [];
  for (const t of list(v("tags"))) {
    const hit = lists.tags.find((x) => same(x.name, t));
    if (hit) tagIds.push(hit.id);
    else bad(`tag “${t}” isn't in the list. Add it in Settings > CRM lists first, or leave it out.`);
  }

  const catText = v("category");
  const category = catText ? (CATEGORY[catText.toLowerCase().replace(/\s+/g, " ")] ?? CATEGORY[catText.toLowerCase().replace(/\s+/g, "")]) : null;
  if (catText && !category) bad(`company category “${catText}” should be OEM, Tier 1, Tier 2 or MSME.`);

  const memText = v("isMcciaMember");
  let isMcciaMember: boolean | null = null;
  if (memText) {
    if (/^(y|yes)$/i.test(memText)) isMcciaMember = true;
    else if (/^(n|no)$/i.test(memText)) isMcciaMember = false;
    else bad(`MCCIA member should be Yes or No (it says “${memText}”).`);
  }
  const notes = (raw.notes ?? "").trim() || null;
  if (notes && notes.length > 5000) bad("the notes are too long (keep them under 5,000 characters).");

  const input: ImportInput | null =
    p.length || !title || !companyName || !contactName || !source || !stage
      ? null
      : {
          title,
          companyName,
          contactName,
          designation: v("designation"),
          phone: phoneText ? phone : null,
          email,
          city: v("city"),
          sourceId: source.id,
          stageId: stage.id,
          deptCodes: [...new Set(deptCodes)],
          expectedValuePaise: value,
          expectedCloseDate: close,
          priority,
          assignedTo: member?.id ?? null,
          tagIds: [...new Set(tagIds)],
          category: category ?? null,
          isMcciaMember,
          mcciaMembershipId: isMcciaMember ? v("mcciaMembershipId") : null,
          notes,
        };
  return { rowNo, raw, input, problems: p };
}

/** A row the template's example came from, left in by mistake: skipped. */
export function isExampleRow(raw: RawRow): boolean {
  return (raw.title ?? "").trim() === EXAMPLE_TITLE && (raw.companyName ?? "").trim() === IMPORT_COLUMNS[1].example;
}
