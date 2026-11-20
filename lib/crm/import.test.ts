import { describe, expect, it } from "vitest";
import { checkImportRow, columnForHeader, isExampleRow, parseImportDate, type ImportLists, type RawRow } from "./import";

const lists: ImportLists = {
  sources: [
    { id: "s-web", name: "Website" },
    { id: "s-other", name: "Other" },
  ],
  stages: [
    { id: "st-new", name: "New", type: "OPEN" },
    { id: "st-neg", name: "Negotiation", type: "OPEN" },
    { id: "st-won", name: "Won", type: "WON" },
    { id: "st-lost", name: "Lost", type: "LOST" },
  ],
  team: [{ id: "m-priya", name: "Priya Shah" }],
  tags: [{ id: "t-urgent", name: "Urgent" }],
  departments: [
    { code: "RPT", name: "Rapid Prototyping" },
    { code: "RPL", name: "Rubber & Polymer Lab" },
  ],
};
const good: RawRow = { title: "UTM tests", companyName: "Kalyani Tooling", contactName: "Neha Patil", phone: "98220 12345", source: "website" };

describe("import rows", () => {
  it("a good row becomes an enquiry in the first open stage", () => {
    const r = checkImportRow({ ...good, departments: "RPT, rubber & polymer lab", tags: "urgent", assignedTo: "priya shah", expectedValue: "1,25,000", expectedCloseDate: "31/12/2026", priority: "★★", category: "Tier 1", isMcciaMember: "yes", mcciaMembershipId: "M/1" }, 3, lists);
    expect(r.problems).toEqual([]);
    expect(r.input).toMatchObject({
      phone: "9822012345",
      sourceId: "s-web",
      stageId: "st-new",
      deptCodes: ["RPT", "RPL"],
      tagIds: ["t-urgent"],
      assignedTo: "m-priya",
      expectedValuePaise: 1_25_000_00,
      expectedCloseDate: "2026-12-31",
      priority: 2,
      category: "TIER1",
      isMcciaMember: true,
      mcciaMembershipId: "M/1",
    });
  });

  it("problems are plain words with the row number", () => {
    const r = checkImportRow({ title: "", companyName: "X", contactName: "Y", phone: "98220", source: "Website" }, 4, lists);
    expect(r.input).toBeNull();
    expect(r.problems).toEqual(["Row 4: the enquiry title is missing.", "Row 4: mobile number should have 10 digits, starting with 6, 7, 8 or 9."]);
    expect(checkImportRow({ ...good, phone: "", email: "" }, 5, lists).problems).toEqual(["Row 5: add a mobile number or an email address."]);
    expect(checkImportRow({ ...good, email: "neha@" }, 6, lists).problems[0]).toMatch(/^Row 6: email “neha@” doesn't look right/);
  });

  it("never invents sources, stages, team members or tags", () => {
    const r = checkImportRow({ ...good, source: "LinkedIn", stage: "Site visit", assignedTo: "Ravi", tags: "Export" }, 7, lists);
    expect(r.input).toBeNull();
    expect(r.problems).toEqual([
      "Row 7: source “LinkedIn” isn't in the list. Use one of: Website, Other.",
      "Row 7: stage “Site visit” isn't on the board. Use one of: New, Negotiation, Won.",
      "Row 7: “Ravi” isn't a team member. Add them in Settings > CRM lists first, or leave it empty.",
      "Row 7: tag “Export” isn't in the list. Add it in Settings > CRM lists first, or leave it out.",
    ]);
    expect(checkImportRow({ ...good, source: "" }, 8, lists).problems[0]).toMatch(/source is missing/);
  });

  it("Lost can't be imported (it needs a reason); Won can", () => {
    expect(checkImportRow({ ...good, stage: "lost" }, 9, lists).problems[0]).toMatch(/can't be imported, because a lost reason is needed/);
    expect(checkImportRow({ ...good, stage: "Won" }, 9, lists).input?.stageId).toBe("st-won");
  });

  it("other checks: department, amount, date, priority, category, member", () => {
    const r = checkImportRow({ ...good, departments: "XYZ", expectedValue: "fifty", expectedCloseDate: "31/02/2026", priority: "5", category: "Big", isMcciaMember: "maybe" }, 10, lists);
    expect(r.problems.map((p) => p.split(":")[1].trim().split(" ").slice(0, 2).join(" "))).toEqual([
      "department “XYZ”",
      "expected value",
      "expected close",
      "priority “5”",
      "company category",
      "MCCIA member",
    ]);
  });

  it("dates in the usual Indian and Excel forms", () => {
    expect(parseImportDate("31/12/2026")).toBe("2026-12-31");
    expect(parseImportDate("1-1-2027")).toBe("2027-01-01");
    expect(parseImportDate("2026-12-31")).toBe("2026-12-31");
    expect(parseImportDate("46387")).toBe("2026-12-31");
    expect(parseImportDate("31/02/2026")).toBeNull();
    expect(parseImportDate("next week")).toBeNull();
  });

  it("headers are matched loosely; the template's example row is recognised", () => {
    expect(columnForHeader("Enquiry title *")).toBe("title");
    expect(columnForHeader("expected value (₹)")).toBe("expectedValue");
    expect(columnForHeader("Mobile number")).toBe("phone");
    expect(columnForHeader("Shoe size")).toBeNull();
    expect(isExampleRow({ title: "3D printing of 20 prototype parts", companyName: "Kalyani Tooling Pvt Ltd" })).toBe(true);
  });
});
