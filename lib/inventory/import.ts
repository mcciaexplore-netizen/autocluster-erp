/**
 * Importing items from Excel, with opening stock. The columns, and checking each row in plain
 * words. Pure (no database, no Excel library). Categories, units, suppliers and departments must
 * match existing names; unknown values are reported as problems and never created. Each row is
 * also checked with the item form's own rules, so an imported item is exactly like a typed one.
 */
import { parseImportDate } from "@/lib/crm/import";
import { EMPTY_ITEM_FORM, itemFormSchema, type ItemFormValues } from "@/lib/validation/inventory";
import { D, parseQty, parseRate } from "./numbers";

export const ITEM_IMPORT_COLUMNS = [
  { key: "name", header: "Item name", required: true, width: 32, example: "SLA resin, imported (grey)" },
  { key: "code", header: "Item code", required: false, width: 12, example: "" },
  { key: "category", header: "Category", required: true, width: 16, example: "Raw material" },
  { key: "departments", header: "Departments", required: false, width: 14, example: "RPT" },
  { key: "unit", header: "Unit", required: true, width: 8, example: "ml" },
  { key: "packName", header: "Pack name", required: false, width: 12, example: "Bottle" },
  { key: "packSize", header: "Pack size", required: false, width: 10, example: "1000" },
  { key: "reorderLevel", header: "Reorder level", required: true, width: 12, example: "1000" },
  { key: "reorderQty", header: "Reorder quantity", required: true, width: 12, example: "3000" },
  { key: "leadTimeDays", header: "Lead time (days)", required: false, width: 10, example: "10" },
  { key: "supplier", header: "Preferred supplier", required: false, width: 26, example: "" },
  { key: "storagePlace", header: "Where it's kept", required: false, width: 18, example: "RPT lab, rack 2" },
  { key: "trackBatches", header: "Track batches (Yes/No)", required: false, width: 12, example: "Yes" },
  { key: "hsnCode", header: "HSN code", required: false, width: 10, example: "3907" },
  { key: "notes", header: "Notes", required: false, width: 30, example: "" },
  { key: "openingQty", header: "Opening stock quantity", required: false, width: 14, example: "2000" },
  { key: "openingRate", header: "Rate per unit before GST (₹)", required: false, width: 14, example: "4.50" },
  { key: "batchNo", header: "Batch no.", required: false, width: 14, example: "R-2609-11" },
  { key: "expiryDate", header: "Expiry date", required: false, width: 12, example: "31/03/2027" },
] as const;

export type ItemImportKey = (typeof ITEM_IMPORT_COLUMNS)[number]["key"];
export type ItemRawRow = Partial<Record<ItemImportKey, string>>;
export const MAX_ITEM_IMPORT_ROWS = 500;

export interface ItemImportLists {
  categories: { id: string; name: string }[];
  units: { id: string; name: string }[];
  suppliers: { id: string; name: string }[];
  departments: { code: string; name: string }[];
  /** Existing items (lower-case names and upper-case codes), so duplicates are caught. */
  existingNames: Set<string>;
  existingCodes: Set<string>;
}

export interface OpeningStock {
  qty: string;
  rate: string;
  batchNo: string | null;
  expiryDate: string | null;
}

export interface CheckedItemRow {
  rowNo: number;
  raw: ItemRawRow;
  /** Set on the row that creates the item. */
  input: ItemFormValues | null;
  /** Set on a later row of the same item: the row number of its first row (this row only adds a batch). */
  addsTo: number | null;
  opening: OpeningStock | null;
  problems: string[];
}

/** Matches a header cell to a column, ignoring case, spaces, "*" and brackets. */
export function itemColumnForHeader(header: string): ItemImportKey | null {
  const norm = (s: string) => s.toLowerCase().replace(/\(.*?\)|\*/g, "").replace(/[^a-z]/g, "");
  const h = norm(header);
  if (!h) return null;
  const hit = ITEM_IMPORT_COLUMNS.find((c) => norm(c.header) === h || c.key.toLowerCase() === h);
  if (hit) return hit.key;
  const aliases: Record<string, ItemImportKey> = { item: "name", name: "name", code: "code", department: "departments", supplier: "supplier", leadtime: "leadTimeDays", place: "storagePlace", location: "storagePlace", batches: "trackBatches", trackbatches: "trackBatches", hsn: "hsnCode", openingstock: "openingQty", quantity: "openingQty", qty: "openingQty", rate: "openingRate", rateperunit: "openingRate", batch: "batchNo", batchno: "batchNo", expiry: "expiryDate" };
  return aliases[h] ?? null;
}

const clean = (v: string | undefined) => (v ?? "").trim().replace(/\s+/g, " ");
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const names = (items: { name: string }[], max = 12) => {
  const n = items.map((i) => i.name);
  return n.length > max ? `${n.slice(0, max).join(", ")} and ${n.length - max} more` : n.join(", ");
};
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Item details that must be the same on every row of one item (later rows may leave them empty). */
const ITEM_DETAIL_KEYS: ItemImportKey[] = ["code", "category", "departments", "unit", "packName", "packSize", "reorderLevel", "reorderQty", "leadTimeDays", "supplier", "storagePlace", "trackBatches", "hsnCode", "notes"];
const NUMERIC_KEYS = new Set<ItemImportKey>(["packSize", "reorderLevel", "reorderQty", "leadTimeDays"]);
const sameDetail = (k: ItemImportKey, a: string, b: string) => {
  if (NUMERIC_KEYS.has(k) && parseQty(a) != null && parseQty(b) != null) return D(parseQty(a)!).eq(D(parseQty(b)!));
  if (k === "trackBatches") return /^y/i.test(a) === /^y/i.test(b);
  if (k === "departments") {
    const set = (x: string) => x.split(/[,;]+/).map((d) => d.trim().toLowerCase()).filter(Boolean).sort().join(",");
    return set(a) === set(b);
  }
  return same(a, b);
};

/**
 * Checks every row. Names and codes must be new. The same item may be on several rows when it
 * tracks batches: the first row creates the item, and each later row only adds opening stock for
 * its own batch (its item details must match the first row, or be left empty).
 * Every problem is a full plain-words sentence starting "Row N:".
 */
export function checkItemRows(rows: { rowNo: number; raw: ItemRawRow }[], lists: ItemImportLists): CheckedItemRow[] {
  const firsts = new Map<string, CheckedItemRow>();
  const batchesOf = new Map<string, Map<string, number>>();
  const seenCodes = new Map<string, number>();
  const out: CheckedItemRow[] = [];
  for (const { rowNo, raw } of rows) {
    const p: string[] = [];
    const bad = (msg: string) => p.push(`Row ${rowNo}: ${msg}`);
    const v = (k: ItemImportKey) => clean(raw[k]);
    const key = v("name").toLowerCase();
    const first = key ? firsts.get(key) : undefined;

    // ---- a later row of an item already in the file: only another batch of opening stock ----
    if (first) {
      const name = v("name");
      const track = first.input?.trackBatches ?? /^y/i.test(clean(first.raw.trackBatches));
      if (first.problems.length) bad(`the first row for “${name}” (row ${first.rowNo}) has problems. Fix that row first.`);
      else if (!track) bad(`“${name}” is already on row ${first.rowNo}. The same item can only be on several rows when it tracks batches (one row per batch).`);
      else {
        const differ = ITEM_DETAIL_KEYS.filter((k) => v(k) && !sameDetail(k, v(k), clean(first.raw[k]))).map((k) => ITEM_IMPORT_COLUMNS.find((c) => c.key === k)!.header);
        if (differ.length) bad(`the item details don't match row ${first.rowNo} (${differ.join(", ")}). Make them the same, or leave them empty on this row.`);
        const unitName = lists.units.find((u) => u.id === first.input?.unitId)?.name ?? "unit";
        if (!v("openingQty")) bad(`“${name}” is already on row ${first.rowNo}, so this row only adds opening stock for another batch. Please enter the quantity.`);
        const opening = parseOpening(v, true, unitName, bad);
        const seen = batchesOf.get(key)!;
        const b = v("batchNo").toLowerCase();
        if (b && seen.has(b)) bad(`batch ${v("batchNo")} of “${name}” is also on row ${seen.get(b)}. Use one row per batch.`);
        else if (b) seen.set(b, rowNo);
        out.push({ rowNo, raw, input: null, addsTo: p.length ? null : first.rowNo, opening: p.length ? null : opening, problems: p });
        continue;
      }
      out.push({ rowNo, raw, input: null, addsTo: null, opening: null, problems: p });
      continue;
    }

    // ---- the first (or only) row of an item: creates it ----
    const category = v("category") ? lists.categories.find((c) => same(c.name, v("category"))) : undefined;
    if (!v("category")) bad(`the category is missing. Use one of: ${names(lists.categories)}.`);
    else if (!category) bad(`category “${v("category")}” isn't in the list. Use one of: ${names(lists.categories)}.`);
    const unit = v("unit") ? lists.units.find((u) => same(u.name, v("unit"))) : undefined;
    if (!v("unit")) bad(`the unit is missing. Use one of: ${names(lists.units)}.`);
    else if (!unit) bad(`unit “${v("unit")}” isn't in the list. Use one of: ${names(lists.units)}.`);
    const supplier = v("supplier") ? lists.suppliers.find((s) => same(s.name, v("supplier"))) : undefined;
    if (v("supplier") && !supplier) bad(`supplier “${v("supplier")}” isn't in Suppliers. Add the supplier first, or leave it empty.`);
    const deptCodes: string[] = [];
    for (const d of v("departments").split(/[,;]+/).map((x) => x.trim()).filter(Boolean)) {
      const hit = lists.departments.find((x) => same(x.code, d) || same(x.name, d));
      if (hit) deptCodes.push(hit.code);
      else bad(`department “${d}” isn't known. Use ${lists.departments.map((x) => x.code).join(", ")}.`);
    }
    let trackBatches = false;
    if (v("trackBatches")) {
      if (/^(y|yes)$/i.test(v("trackBatches"))) trackBatches = true;
      else if (!/^(n|no)$/i.test(v("trackBatches"))) bad(`Track batches should be Yes or No (it says “${v("trackBatches")}”).`);
    }

    const form: ItemFormValues = {
      ...EMPTY_ITEM_FORM,
      name: v("name"),
      code: v("code").toUpperCase(),
      categoryId: category?.id ?? "x",
      deptCodes: [...new Set(deptCodes)],
      unitId: unit?.id ?? "x",
      packName: v("packName"),
      packSize: v("packSize"),
      reorderLevel: v("reorderLevel"),
      reorderQty: v("reorderQty"),
      leadTimeDays: v("leadTimeDays"),
      preferredSupplierId: supplier?.id ?? "",
      storagePlace: v("storagePlace"),
      trackBatches,
      hsnCode: v("hsnCode"),
      notes: (raw.notes ?? "").trim(),
      isActive: true,
    };
    // The item form's own rules (names, quantities, pack, lead time, HSN code).
    const parsed = itemFormSchema.safeParse(form);
    if (!parsed.success) for (const issue of parsed.error.issues) bad(lowerFirst(issue.message));
    if (form.name && lists.existingNames.has(key)) bad(`there is already an item called “${form.name}”.`);
    if (form.code) {
      if (lists.existingCodes.has(form.code)) bad(`item code ${form.code} is already used. Leave it empty for the next number.`);
      else if (seenCodes.has(form.code)) bad(`item code ${form.code} is also on row ${seenCodes.get(form.code)}.`);
      else seenCodes.set(form.code, rowNo);
    }

    // Opening stock (optional): a quantity needs a rate; batch items need a batch number and expiry.
    const opening = parseOpening(v, trackBatches, unit?.name ?? "unit", bad);
    if (!v("openingQty") && (v("openingRate") || v("batchNo") || v("expiryDate"))) bad("a rate, batch number or expiry date was given without an opening stock quantity.");

    const row: CheckedItemRow = { rowNo, raw, input: p.length || !parsed.success ? null : parsed.data, addsTo: null, opening: p.length ? null : opening, problems: p };
    if (key) {
      firsts.set(key, row);
      batchesOf.set(key, new Map(v("batchNo") ? [[v("batchNo").toLowerCase(), rowNo]] : []));
    }
    out.push(row);
  }
  return out;
}

/** The opening stock columns of one row (null when no quantity, or a quantity of 0). */
function parseOpening(v: (k: ItemImportKey) => string, trackBatches: boolean, unitName: string, bad: (m: string) => void): OpeningStock | null {
  const qtyText = v("openingQty");
  const rateText = v("openingRate");
  const batchNo = v("batchNo");
  const expiryText = v("expiryDate");
  if (!qtyText) return null;
  const qty = parseQty(qtyText);
  if (qty != null && D(qty).eq(0)) return null;
  const rate = rateText ? parseRate(rateText) : null;
  const expiry = parseImportDate(expiryText || null);
  if (qty == null) bad(`opening stock “${qtyText}” should be a number with up to 3 decimals, e.g. 2000 or 2.5.`);
  if (!rateText) bad(`opening stock needs the rate per ${unitName} before GST, e.g. 4.50.`);
  else if (rate == null || D(rate).lte(0)) bad(`rate “${rateText}” should be an amount in rupees above 0, with up to 4 decimals, e.g. 4.50.`);
  if (trackBatches) {
    if (!batchNo) bad("this item tracks batches, so the opening stock needs a batch number.");
    if (!expiryText) bad("this item tracks batches, so the opening stock needs an expiry date, e.g. 31/03/2027.");
    else if (!expiry) bad(`expiry date “${expiryText}” should be a date, e.g. 31/03/2027.`);
  } else if (batchNo || expiryText) bad("a batch number or expiry date is only used when Track batches is Yes.");
  if (batchNo.length > 40) bad("the batch number is too long (keep it under 40 characters).");
  return qty != null && rate != null && D(rate).gt(0) ? { qty, rate, batchNo: trackBatches ? batchNo : null, expiryDate: trackBatches ? expiry : null } : null;
}

/** The template's example row, left in by mistake: skipped. */
export function isExampleItemRow(raw: ItemRawRow): boolean {
  return clean(raw.name) === ITEM_IMPORT_COLUMNS[0].example && clean(raw.batchNo) === "R-2609-11";
}
