import { describe, expect, it } from "vitest";
import { orgInitials } from "./org";

describe("orgInitials", () => {
  it("takes the first two real words", () => {
    expect(orgInitials("Demo Manufacturing Co., Pune")).toBe("DM");
    expect(orgInitials("Auto Cluster Development and Research Institute (ACDRI)")).toBe("AC");
    expect(orgInitials("Kale Engineering Pvt Ltd")).toBe("KE");
    expect(orgInitials("sahyadri")).toBe("S");
    expect(orgInitials("")).toBe("•");
  });
});
