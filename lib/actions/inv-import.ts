"use server";

import { logActivity } from "@/lib/activity";
import { doneByFor, logOnBehalf } from "@/lib/auth/done-by";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { importItems } from "@/db/inv-import-writer";
import { UserFacingError } from "@/db/quote-writer";
import { allow } from "@/lib/auth/guard";
import type { Permission } from "@/lib/auth/permissions";
import { getItemImportLists } from "@/lib/inventory-data";
import { itemProblemRowsWorkbook, readItemImportFile } from "@/lib/inventory/excel";
import { checkItemRows, ITEM_IMPORT_COLUMNS, MAX_ITEM_IMPORT_ROWS, type CheckedItemRow, type ItemRawRow } from "@/lib/inventory/import";
import { formatQty, formatRate } from "@/lib/inventory/numbers";

type Result<T> = { ok: true; data: T } | { ok: false; message: string };

export interface ItemPreviewRow {
  rowNo: number;
  raw: ItemRawRow;
  ok: boolean;
  problems: string[];
  name: string;
  code: string;
  category: string;
  opening: string | null;
}

async function guard<T>(perm: Permission | Permission[], fn: () => Promise<T>): Promise<Result<T>> {
  const g = await allow(perm);
  if (!g.ok) return { ok: false, message: g.message };
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof UserFacingError) return { ok: false, message: e.message };
    if (e instanceof z.ZodError) return { ok: false, message: "The file details didn't come through. Please upload the file again." };
    console.error("item import", e);
    return { ok: false, message: "We couldn't read that file right now. Please try again." };
  }
}

const rawRow = z.object(Object.fromEntries(ITEM_IMPORT_COLUMNS.map((c) => [c.key, z.string().max(6000).optional()])) as Record<string, z.ZodOptional<z.ZodString>>);
const rowsSchema = z.array(z.object({ rowNo: z.number().int().min(1).max(100000), raw: rawRow })).min(1).max(MAX_ITEM_IMPORT_ROWS);

async function check(rows: unknown): Promise<CheckedItemRow[]> {
  return checkItemRows(rowsSchema.parse(rows) as { rowNo: number; raw: ItemRawRow }[], await getItemImportLists());
}

function preview(c: CheckedItemRow, all: CheckedItemRow[]): ItemPreviewRow {
  const unit = c.raw.unit || (c.addsTo != null ? (all.find((x) => x.rowNo === c.addsTo)?.raw.unit ?? "") : "");
  return {
    rowNo: c.rowNo,
    raw: c.raw,
    ok: !c.problems.length,
    problems: c.problems,
    name: c.raw.name ?? "",
    code: c.input?.code || (c.input ? "Next number" : (c.raw.code ?? "")),
    category: c.addsTo ? `Another batch of the item on row ${c.addsTo}` : (c.raw.category ?? ""),
    opening: c.opening ? `${formatQty(c.opening.qty, unit)} at ${formatRate(c.opening.rate)}/${unit}${c.opening.batchNo ? `, batch ${c.opening.batchNo}` : ""}` : null,
  };
}

/** Reads the uploaded file and checks every row. Nothing is saved yet. */
export async function previewItemImportAction(form: FormData): Promise<Result<{ fileName: string; rows: ItemPreviewRow[]; skippedExample: boolean }>> {
  return guard("inventory.items", async () => {
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) throw new UserFacingError("Please choose the filled-in Excel file first.");
    if (!/\.xlsx$/i.test(file.name)) throw new UserFacingError("Please upload an Excel file (.xlsx). If you have a .xls or .csv file, open it in Excel and save it as .xlsx.");
    const { rows, skippedExample } = await readItemImportFile(new Uint8Array(await file.arrayBuffer()));
    const checked = await check(rows);
    return { fileName: file.name, rows: checked.map((c) => preview(c, checked)), skippedExample };
  });
}

/** Imports the good rows. Every row is checked again here, so only good rows are ever saved. */
export async function importItemsAction(rows: { rowNo: number; raw: ItemRawRow }[], fileName: string, doneBy: string | null) {
  return guard("inventory.items", async () => {
    const good = (await check(rows)).filter((c) => !c.problems.length);
    if (!good.length) throw new UserFacingError("None of these rows can be imported. Please fix the problems and upload the file again.");
    const who = await doneByFor(doneBy ? z.string().uuid().parse(doneBy) : null);
    const r = await importItems(
      db,
      good.map((c) => ({ rowNo: c.rowNo, input: c.input, addsTo: c.addsTo, opening: c.opening })),
      z.string().max(200).parse(fileName).replace(/[^\w .()-]/g, ""),
      { doneBy: who.id },
    );
    await logActivity({ area: "Inventory", action: "import", summary: `Imported ${r.items.length} items from Excel (${fileName})`, entityType: "inv_item", entityId: null });
    await logOnBehalf(who, "Inventory", `imported ${r.items.length} items`);
    revalidatePath("/", "layout");
    return { imported: r.items.length, firstCode: r.items[0]?.code ?? "", lastCode: r.items.at(-1)?.code ?? "", openingDoc: r.openingDoc, openingLines: r.openingLines };
  });
}

/** "Download problem rows": the bad rows with their problems listed, as an Excel file (base64). */
export async function itemProblemRowsAction(rows: { rowNo: number; raw: ItemRawRow }[]): Promise<Result<{ base64: string; fileName: string }>> {
  return guard("inventory.items", async () => {
    const bad = (await check(rows)).filter((c) => c.problems.length);
    const bytes = await itemProblemRowsWorkbook(bad);
    return { base64: Buffer.from(bytes).toString("base64"), fileName: `Items-to-fix-${bad.length}-${bad.length === 1 ? "row" : "rows"}.xlsx` };
  });
}
