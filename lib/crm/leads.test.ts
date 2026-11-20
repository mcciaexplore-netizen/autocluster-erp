import { describe, expect, it } from "vitest";
import { activityStatus, filtersFromParams, matchesFilters, sortLeads, type FilterableLead } from "./leads";
import { todayInIndia } from "@/lib/tickets";

const lead = (p: Partial<FilterableLead> = {}): FilterableLead => ({
  leadNo: "ACDRI/EN/2026-27/0001",
  title: "3D printing of 20 prototype parts",
  companyName: "Sahyadri Auto Components",
  contactName: "Rohan Kulkarni",
  phone: "9822012345",
  email: "rohan@sahyadri.example",
  stageId: "s1",
  priority: 1,
  expectedValuePaise: 50_000_00,
  expectedCloseDate: "2026-11-25",
  sourceId: "web",
  assignedToId: "priya",
  depts: ["RPT"],
  tagIds: ["urgent"],
  nextActivityDate: null,
  createdAt: "2026-11-10T05:00:00.000Z",
  stageType: "OPEN",
  wonAt: null,
  ...p,
});
const TODAY = "2026-11-19";

describe("activity colours use India time", () => {
  it("overdue, today, planned, none", () => {
    expect(activityStatus("2026-11-18", TODAY)).toBe("overdue");
    expect(activityStatus("2026-11-19", TODAY)).toBe("today");
    expect(activityStatus("2026-11-20", TODAY)).toBe("planned");
    expect(activityStatus(null, TODAY)).toBe("none");
  });
  it("just after midnight in India is already the next day, even though it's still the previous day in UTC", () => {
    // 19 Nov 2026, 00:30 in India = 18 Nov 2026, 19:00 UTC
    const today = todayInIndia(new Date("2026-11-18T19:00:00Z"));
    expect(today).toBe("2026-11-19");
    expect(activityStatus("2026-11-18", today)).toBe("overdue");
    expect(activityStatus("2026-11-19", today)).toBe("today");
  });
});

describe("filters", () => {
  const f = (q: Record<string, string>) => filtersFromParams(new URLSearchParams(q));
  it("search covers title, company, contact, mobile, email and enquiry no.", () => {
    for (const q of ["prototype", "sahyadri", "rohan", "98220", "+91 98220 12345".slice(4), "sahyadri.example", "EN/2026-27/0001"]) expect(matchesFilters(lead(), f({ q }), TODAY)).toBe(true);
    expect(matchesFilters(lead(), f({ q: "machining" }), TODAY)).toBe(false);
  });
  it("assigned, source, department, priority, tag", () => {
    expect(matchesFilters(lead(), f({ assigned: "priya", source: "web", dept: "RPT", priority: "1", tag: "urgent" }), TODAY)).toBe(true);
    expect(matchesFilters(lead(), f({ assigned: "none" }), TODAY)).toBe(false);
    expect(matchesFilters(lead({ assignedToId: null }), f({ assigned: "none" }), TODAY)).toBe(true);
    expect(matchesFilters(lead(), f({ dept: "ENV" }), TODAY)).toBe(false);
    expect(matchesFilters(lead(), f({ priority: "3" }), TODAY)).toBe(false);
  });
  it("activity and expected close", () => {
    expect(matchesFilters(lead({ nextActivityDate: "2026-11-01" }), f({ activity: "overdue" }), TODAY)).toBe(true);
    expect(matchesFilters(lead({ nextActivityDate: "2026-12-01" }), f({ activity: "upcoming" }), TODAY)).toBe(true);
    expect(matchesFilters(lead(), f({ activity: "none" }), TODAY)).toBe(true);
    expect(matchesFilters(lead(), f({ close: "thisMonth" }), TODAY)).toBe(true);
    expect(matchesFilters(lead({ expectedCloseDate: "2026-12-05" }), f({ close: "nextMonth" }), TODAY)).toBe(true);
    expect(matchesFilters(lead({ expectedCloseDate: "2026-11-01" }), f({ close: "passed" }), TODAY)).toBe(true);
    expect(matchesFilters(lead({ expectedCloseDate: null }), f({ close: "none" }), TODAY)).toBe(true);
  });
  it("ignores unknown filter values", () => {
    expect(f({ activity: "nonsense", priority: "9" })).toMatchObject({ activity: undefined, priority: undefined });
  });
});

describe("sorting", () => {
  const a = lead({ title: "a", priority: 1, expectedValuePaise: 100, nextActivityDate: "2026-11-30", createdAt: "2026-11-01T00:00:00Z" });
  const b = lead({ title: "b", priority: 3, expectedValuePaise: null, nextActivityDate: null, createdAt: "2026-11-05T00:00:00Z" });
  const c = lead({ title: "c", priority: 2, expectedValuePaise: 500, nextActivityDate: "2026-11-20", createdAt: "2026-11-03T00:00:00Z" });
  const order = (k: Parameters<typeof sortLeads>[1]) => sortLeads([a, b, c], k).map((x) => x.title).join("");
  it("priority, next activity, expected value, newest", () => {
    expect(order("priority")).toBe("bca");
    expect(order("activity")).toBe("cab");
    expect(order("value")).toBe("cab");
    expect(order("newest")).toBe("bca");
  });
});

import { parseMobileOrEmail } from "./contact";
describe("one 'Mobile or email' box", () => {
  it("treats text with @ as email and the rest as a mobile, checking whichever was typed", () => {
    expect(parseMobileOrEmail("+91 98220 12345")).toEqual({ phone: "9822012345", email: null, problem: null });
    expect(parseMobileOrEmail(" Neha@Kalyani.Example ")).toEqual({ phone: null, email: "neha@kalyani.example", problem: null });
    expect(parseMobileOrEmail("98220").problem).toMatch(/10 digits/);
    expect(parseMobileOrEmail("neha@kalyani").problem).toMatch(/email/);
    expect(parseMobileOrEmail("neha kalyani").problem).toMatch(/mobile number or an email/);
    expect(parseMobileOrEmail("  ").problem).toMatch(/Please enter/);
  });
});

describe("home card filters", () => {
  const f = (q: Record<string, string>) => filtersFromParams(new URLSearchParams(q));
  it("new this month uses the India date of creation", () => {
    expect(matchesFilters(lead({ createdAt: "2026-11-01T00:30:00.000Z" }), f({ created: "thisMonth" }), TODAY)).toBe(true);
    // 31 Oct 20:00 UTC is already 1 Nov in India
    expect(matchesFilters(lead({ createdAt: "2026-10-31T20:00:00.000Z" }), f({ created: "thisMonth" }), TODAY)).toBe(true);
    expect(matchesFilters(lead({ createdAt: "2026-10-31T17:00:00.000Z" }), f({ created: "thisMonth" }), TODAY)).toBe(false);
  });
  it("open, and won this month", () => {
    expect(matchesFilters(lead(), f({ state: "open" }), TODAY)).toBe(true);
    expect(matchesFilters(lead({ stageType: "WON" }), f({ state: "open" }), TODAY)).toBe(false);
    expect(matchesFilters(lead({ stageType: "WON", wonAt: "2026-11-05T06:00:00.000Z" }), f({ won: "thisMonth" }), TODAY)).toBe(true);
    expect(matchesFilters(lead({ stageType: "WON", wonAt: "2026-10-05T06:00:00.000Z" }), f({ won: "thisMonth" }), TODAY)).toBe(false);
  });
});
