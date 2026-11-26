import { describe, expect, it } from "vitest";
import { backAt, isOutOfUse, liveStatus } from "./live-status";

const now = new Date("2026-11-26T06:30:00Z"); // Thu 26 Nov, 12:00 India time
const inService = { status: "AVAILABLE" as const, isActive: true };

describe("a machine's live status", () => {
  it("Running: a job is running (the chip says which, and who)", () => {
    expect(liveStatus({ machine: inService, now, running: { ticketNo: "ACDRI/TK/2026-27/0275", operator: "Rohan Deshpande" } })).toEqual({ kind: "running", label: "Running: 0275 (Rohan)" });
  });

  it("a booking that has started is Running; one that hasn't is Booked, not started", () => {
    const booking = { ticketNo: "ACDRI/TK/2026-27/0273" };
    expect(liveStatus({ machine: inService, now, bookingNow: booking, running: { ticketNo: booking.ticketNo, operator: null } }).kind).toBe("running");
    expect(liveStatus({ machine: inService, now, bookingNow: booking })).toEqual({ kind: "booked", label: "Booked now: 0273, not started" });
  });

  it("Free: no booking now and the machine is in service", () => {
    expect(liveStatus({ machine: inService, now })).toEqual({ kind: "free", label: "Free" });
  });

  it("Under maintenance / Calibration / Breakdown from blocked time, with when it's back", () => {
    const today17 = new Date("2026-11-26T11:30:00Z"); // 17:00 India time
    expect(liveStatus({ machine: inService, now, blockNow: { type: "MAINTENANCE", end: today17 } })).toEqual({ kind: "maintenance", label: "Under maintenance · back at 17:00" });
    expect(liveStatus({ machine: inService, now, blockNow: { type: "CALIBRATION", end: today17 } })).toEqual({ kind: "calibration", label: "Calibration · back at 17:00" });
    const friday = new Date("2026-11-27T04:30:00Z"); // Fri 10:00
    expect(liveStatus({ machine: inService, now, blockNow: { type: "BREAKDOWN", end: friday } })).toEqual({ kind: "breakdown", label: "Breakdown · back Fri 10:00" });
    // Blocked time wins over a booking that hasn't started.
    expect(liveStatus({ machine: inService, now, blockNow: { type: "MAINTENANCE", end: today17 }, bookingNow: { ticketNo: "X/0001" } }).kind).toBe("maintenance");
  });

  it("the machine's own setting: Breakdown or Under maintenance without blocked time; Inactive", () => {
    expect(liveStatus({ machine: { status: "BREAKDOWN", isActive: true }, now })).toEqual({ kind: "breakdown", label: "Breakdown" });
    expect(liveStatus({ machine: { status: "MAINTENANCE", isActive: true }, now })).toEqual({ kind: "maintenance", label: "Under maintenance" });
    expect(liveStatus({ machine: { status: "INACTIVE", isActive: true }, now })).toEqual({ kind: "inactive", label: "Inactive" });
    expect(liveStatus({ machine: { status: "AVAILABLE", isActive: false }, now, running: { ticketNo: "X/0001", operator: null } }).kind).toBe("inactive");
  });

  it("only maintenance, calibration, breakdown and inactive count as not available", () => {
    expect((["running", "booked", "free", "blocked"] as const).map(isOutOfUse)).toEqual([false, false, false, false]);
    expect((["maintenance", "calibration", "breakdown", "inactive"] as const).map(isOutOfUse)).toEqual([true, true, true, true]);
    expect(backAt(new Date("2026-11-26T11:30:00Z"), now)).toBe("back at 17:00");
  });
});
