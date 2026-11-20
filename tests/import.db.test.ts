import ExcelJS from "exceljs";
import { eq, like } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { importLeads, type LeadInput } from "@/db/lead-writer";
import * as s from "@/db/schema";
import { importTemplate, problemRowsWorkbook, readImportFile } from "@/lib/crm/excel";
import { checkImportRow, type ImportLists } from "@/lib/crm/import";
import { freshDemoData, testDb } from "./helpers";

const skip = !!process.env.SKIP_DB_TESTS;
const { db, pool } = testDb();

async function lists(): Promise<ImportLists> {
  const stages = await db.select().from(s.crmStages).orderBy(s.crmStages.sortOrder);
  return {
    sources: (await db.select().from(s.crmSources)).filter((x) => x.isActive).map(({ id, name }) => ({ id, name })),
    stages: stages.map(({ id, name, type }) => ({ id, name, type })),
    team: (await db.select().from(s.teamMembers)).map(({ id, name }) => ({ id, name })),
    tags: (await db.select().from(s.crmTags)).map(({ id, name }) => ({ id, name })),
    departments: (await db.select().from(s.departments)).map(({ code, name }) => ({ code, name })),
  };
}

describe.skipIf(skip)("importing enquiries from Excel (database)", () => {
  beforeEach(async () => {
    await freshDemoData(db);
  });
  afterAll(async () => {
    await pool.end();
  });

  it("template in, good rows imported, bad rows explained, nothing unknown created", async () => {
    const l = await lists();
    // Fill the real template like a person would: leave the example row, add 3 rows (1 bad).
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await importTemplate(l)).buffer as ArrayBuffer);
    const ws = wb.getWorksheet("Enquiries")!;
    // Typed into rows 3, 4 and 5, as a person would (the dropdowns already reserve rows 2-301).
    const put = (r: number, vals: unknown[]) => vals.forEach((v, i) => (ws.getCell(r, i + 1).value = v as ExcelJS.CellValue));
    put(3, ["Salt spray test", "Bharat Fasteners", "Amit Joshi", "", "9890011122", "", "Chakan", "Phone call", "Negotiation", "ENV", 40000, new Date(Date.UTC(2026, 11, 15)), 3, "", "Urgent"]);
    put(4, ["Bad row", "Nowhere Ltd", "Ravi", "", "12345", "", "", "LinkedIn", "Site visit"]);
    put(5, ["Email only", "Lumax Pune", "Sunil Rao", "", "", "sunil@lumax.example", "", "Website"]);
    const bytes = new Uint8Array(await wb.xlsx.writeBuffer());

    const read = await readImportFile(bytes);
    expect(read.skippedExample).toBe(true);
    expect(read.rows.map((r) => r.rowNo)).toEqual([3, 4, 5]);
    const checked = read.rows.map((r) => checkImportRow(r.raw, r.rowNo, l));
    expect(checked.map((c) => !!c.input)).toEqual([true, false, true]);
    expect(checked[1].problems).toEqual([
      "Row 4: mobile number should have 10 digits, starting with 6, 7, 8 or 9.",
      expect.stringMatching(/^Row 4: source “LinkedIn” isn't in the list/),
      expect.stringMatching(/^Row 4: stage “Site visit” isn't on the board/),
    ]);

    const sourcesBefore = (await db.select().from(s.crmSources)).length;
    const stagesBefore = (await db.select().from(s.crmStages)).length;
    const made = await importLeads(
      db,
      checked.filter((c) => c.input).map((c) => ({ rowNo: c.rowNo, input: c.input as LeadInput })),
      "enquiries.xlsx",
    );
    expect(made.map((m) => m.rowNo)).toEqual([3, 5]);
    expect((await db.select().from(s.crmSources)).length).toBe(sourcesBefore);
    expect((await db.select().from(s.crmStages)).length).toBe(stagesBefore);

    const [salt] = await db.select().from(s.leads).where(eq(s.leads.title, "Salt spray test"));
    expect(salt).toMatchObject({ phone: "9890011122", expectedValue: 40_000_00, expectedCloseDate: "2026-12-15", priority: 3, city: "Chakan" });
    expect(salt.stageId).toBe(l.stages.find((x) => x.name === "Negotiation")!.id);
    const [ev] = await db.select().from(s.leadEvents).where(eq(s.leadEvents.leadId, salt.id));
    expect(ev.message).toBe("Enquiry imported from Excel into Negotiation (enquiries.xlsx, row 3)");
    expect(await db.select().from(s.leads).where(like(s.leads.title, "Bad row%"))).toHaveLength(0);

    // The problem-rows file has the original values and the problems.
    const out = new ExcelJS.Workbook();
    await out.xlsx.load((await problemRowsWorkbook(checked.filter((c) => !c.input))).buffer as ArrayBuffer);
    const row2 = out.getWorksheet("Enquiries")!.getRow(2).values as unknown[];
    expect(row2).toContain("Bad row");
    expect(String(row2.at(-1))).toMatch(/^Was row 4: mobile number should have 10 digits/);
  });

  it("files without the required columns, or empty, are explained", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Sheet1").addRow(["Name", "Phone"]);
    await expect(readImportFile(new Uint8Array(await wb.xlsx.writeBuffer()))).rejects.toThrow(/required columns are missing: Enquiry title, Company, Source/);
    await expect(readImportFile(new TextEncoder().encode("not an excel file"))).rejects.toThrow(/couldn't be read/);
    const l = await lists();
    await expect(readImportFile(await importTemplate(l))).rejects.toThrow(/No enquiries were found/);
  });
});
