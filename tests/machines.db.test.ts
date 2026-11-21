import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { addHoliday, blockMachine, createMachine, deleteBlock, importHolidays, markBreakdown, markFixed, nextMachineCode, updateMachine } from "@/db/machine-writer";
import * as s from "@/db/schema";
import { istAt } from "@/lib/planning/hours";
import { EMPTY_MACHINE_FORM } from "@/lib/validation/planning";
import { freshDemoData, testDb } from "./helpers";

const skip = !!process.env.SKIP_DB_TESTS;
const { db, pool } = testDb();
afterAll(async () => {
  await pool.end();
});
const at = (date: string, time: string) => istAt(date, Number(time.slice(0, 2)) * 60 + Number(time.slice(3)));

describe.skipIf(skip)("machines, blocked time and holidays (database)", () => {
  beforeEach(async () => {
    await freshDemoData(db);
  });

  it("MET is a fifth department; machines get codes MC-01, MC-02 and can run services from any department", async () => {
    expect((await db.select().from(s.departments)).map((d) => d.code)).toEqual(["RPT", "PPF", "ENV", "RPL", "MET"]);
    const svcs = await db.select().from(s.services);
    const xenon = svcs.find((x) => x.name === "Xenon test chamber")!; // priced under RPL
    const a = await createMachine(db, { ...EMPTY_MACHINE_FORM, name: "Xenon Test Chamber", deptCode: "ENV", runsNonstop: true, nablAccredited: true, serviceIds: [xenon.id] });
    const b = await createMachine(db, { ...EMPTY_MACHINE_FORM, name: "Co-ordinate Measuring Machine (CMM)", deptCode: "MET", makeModel: "Accurate Cordimesur" });
    expect([a.code, b.code]).toEqual(["MC-01", "MC-02"]);
    expect(await db.select().from(s.machineServices).where(eq(s.machineServices.machineId, a.id))).toHaveLength(1);
    await expect(createMachine(db, { ...EMPTY_MACHINE_FORM, name: "xenon test chamber", deptCode: "ENV" })).rejects.toThrow("There is already a machine called “xenon test chamber”.");
    await expect(createMachine(db, { ...EMPTY_MACHINE_FORM, name: "UTM", deptCode: "RPL", code: "mc-02" })).rejects.toThrow("Machine code MC-02 is already used.");
    // a typed code is skipped by the next automatic one
    await createMachine(db, { ...EMPTY_MACHINE_FORM, name: "UTM", deptCode: "RPL", code: "MC-03" });
    expect(await nextMachineCode(db)).toBe("MC-04");
    // inactive status hides it from pickers
    await updateMachine(db, b.id, { ...EMPTY_MACHINE_FORM, name: b.name, deptCode: "MET", status: "INACTIVE" });
    expect((await db.select().from(s.machines).where(eq(s.machines.id, b.id)))[0]).toMatchObject({ status: "INACTIVE", isActive: false });
  });

  it("block time: the end must be after the start; breakdown sets the status and 'Working again' ends it now", async () => {
    const m = await createMachine(db, { ...EMPTY_MACHINE_FORM, name: "5-Axis VMC (Non-Continuous)", deptCode: "PPF" });
    await expect(blockMachine(db, { machineId: m.id, type: "MAINTENANCE", start: at("2026-12-01", "10:00"), end: at("2026-12-01", "09:00") })).rejects.toThrow("The end should be after the start.");
    const r = await blockMachine(db, { machineId: m.id, type: "CALIBRATION", start: at("2026-12-01", "09:00"), end: at("2026-12-01", "13:00"), note: "Annual calibration" });
    expect(r.clashes).toEqual([]);
    const now = at("2026-11-20", "11:00");
    await expect(markBreakdown(db, m.id, at("2026-11-20", "10:00"), null, { now })).rejects.toThrow(/later than now/);
    await markBreakdown(db, m.id, at("2026-11-22", "18:00"), "Spindle noise", { now });
    expect((await db.select().from(s.machines).where(eq(s.machines.id, m.id)))[0].status).toBe("BREAKDOWN");
    const fixedAt = at("2026-11-21", "15:00");
    await markFixed(db, m.id, { now: fixedAt });
    const blocks = await db.select().from(s.machineBlocks).where(eq(s.machineBlocks.type, "BREAKDOWN"));
    expect(blocks[0].endAt).toEqual(fixedAt);
    expect((await db.select().from(s.machines).where(eq(s.machines.id, m.id)))[0].status).toBe("AVAILABLE");
    // past blocked time is kept; future blocked time can be removed
    await expect(deleteBlock(db, blocks[0].id, { now: at("2026-11-25", "09:00") })).rejects.toThrow(/kept for the records/);
    await expect(deleteBlock(db, r.block.id, { now: at("2026-11-25", "09:00") })).resolves.toMatchObject({ ended: false });
  });

  it("holidays: one per date; importing skips dates already in the list", async () => {
    await addHoliday(db, "2026-12-25", "Christmas");
    await expect(addHoliday(db, "2026-12-25", "Xmas")).rejects.toThrow("Christmas is already on that date.");
    const r = await importHolidays(db, [
      { date: "2026-12-25", name: "Christmas" },
      { date: "2027-01-26", name: "Republic Day" },
    ]);
    expect(r).toEqual({ added: 1, skipped: 1 });
  });
});
