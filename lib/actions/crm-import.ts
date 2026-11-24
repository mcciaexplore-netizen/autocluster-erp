"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { importLeads } from "@/db/lead-writer";
import { UserFacingError } from "@/db/quote-writer";
import { allow } from "@/lib/auth/guard";
import type { Permission } from "@/lib/auth/permissions";
import { getImportLists } from "@/lib/crm-data";
import { problemRowsWorkbook, readImportFile } from "@/lib/crm/excel";
import { checkImportRow, IMPORT_COLUMNS, MAX_IMPORT_ROWS, type CheckedRow, type RawRow } from "@/lib/crm/import";

type Result<T> = { ok: true; data: T } | { ok: false; message: string };

export interface PreviewRow {
  rowNo: number;
  raw: RawRow;
  ok: boolean;
  problems: string[];
  title: string;
  company: string;
  stage: string;
}

async function guard<T>(perm: Permission | Permission[], fn: () => Promise<T>): Promise<Result<T>> {
  const g = await allow(perm);
  if (!g.ok) return { ok: false, message: g.message };
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof UserFacingError) return { ok: false, message: e.message };
    if (e instanceof z.ZodError) return { ok: false, message: "The file details didn't come through. Please upload the file again." };
    console.error("crm import", e);
    return { ok: false, message: "We couldn't read that file right now. Please try again." };
  }
}

const rawRow = z.object(Object.fromEntries(IMPORT_COLUMNS.map((c) => [c.key, z.string().max(6000).optional()])) as Record<string, z.ZodOptional<z.ZodString>>);
const rowsSchema = z.array(z.object({ rowNo: z.number().int().min(1).max(100000), raw: rawRow })).min(1).max(MAX_IMPORT_ROWS);

async function check(rows: { rowNo: number; raw: RawRow }[]): Promise<CheckedRow[]> {
  const lists = await getImportLists();
  return rows.map((r) => checkImportRow(r.raw, r.rowNo, lists));
}

function preview(c: CheckedRow, stages: Map<string, string>): PreviewRow {
  return {
    rowNo: c.rowNo,
    raw: c.raw,
    ok: !!c.input,
    problems: c.problems,
    title: c.raw.title ?? "",
    company: c.raw.companyName ?? "",
    stage: c.input ? (stages.get(c.input.stageId) ?? "") : (c.raw.stage ?? ""),
  };
}

/** Step 3: reads the uploaded file and checks every row. Nothing is saved yet. */
export async function previewImportAction(form: FormData): Promise<Result<{ fileName: string; rows: PreviewRow[]; skippedExample: boolean }>> {
  return guard("crm.import", async () => {
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) throw new UserFacingError("Please choose the filled-in Excel file first.");
    if (!/\.xlsx$/i.test(file.name)) throw new UserFacingError("Please upload an Excel file (.xlsx). If you have a .xls or .csv file, open it in Excel and save it as .xlsx.");
    const { rows, skippedExample } = await readImportFile(new Uint8Array(await file.arrayBuffer()));
    const lists = await getImportLists();
    const stages = new Map(lists.stages.map((s) => [s.id, s.name]));
    return { fileName: file.name, rows: rows.map((r) => preview(checkImportRow(r.raw, r.rowNo, lists), stages)), skippedExample };
  });
}

/** Step 4: imports the good rows. Every row is checked again here, so only good rows are ever saved. */
export async function importLeadsAction(rows: { rowNo: number; raw: RawRow }[], fileName: string): Promise<Result<{ imported: number; leadNos: string[]; nowFailing: number }>> {
  return guard("crm.import", async () => {
    const checked = await check(rowsSchema.parse(rows) as { rowNo: number; raw: RawRow }[]);
    const good = checked.filter((c) => c.input);
    if (!good.length) throw new UserFacingError("None of these rows can be imported. Please fix the problems and upload the file again.");
    const made = await importLeads(
      db,
      good.map((c) => ({ rowNo: c.rowNo, input: c.input! })),
      z.string().max(200).parse(fileName).replace(/[^\w .()-]/g, ""),
    );
    revalidatePath("/", "layout");
    return { imported: made.length, leadNos: made.map((m) => m.leadNo), nowFailing: checked.length - good.length };
  });
}

/** "Download problem rows": the bad rows with their problems listed, as an Excel file (base64). */
export async function problemRowsAction(rows: { rowNo: number; raw: RawRow }[]): Promise<Result<{ base64: string; fileName: string }>> {
  return guard("crm.import", async () => {
    const checked = (await check(rowsSchema.parse(rows) as { rowNo: number; raw: RawRow }[])).filter((c) => !c.input);
    const bytes = await problemRowsWorkbook(checked);
    return { base64: Buffer.from(bytes).toString("base64"), fileName: `Enquiries-to-fix-${checked.length}-${checked.length === 1 ? "row" : "rows"}.xlsx` };
  });
}
