import { describe, expect, it } from "vitest";
import { calculateLine, calculateTotals, customerRate, DEFAULT_PRICING_SETTINGS, priceTypeFor, toPaise, type LineInput } from "./pricing";
import { fillTemplate, DEFAULT_WHATSAPP_TEMPLATE } from "./reminder-templates";
import {
  amountLeft,
  addDays,
  daysBetween,
  dueChip,
  followUpDue,
  invoiceChips,
  moveKind,
  moveProblem,
  paymentProblem,
  poAmountMatches,
  splitQuotation,
  todayInIndia,
} from "./tickets";

/** Builds a quotation the same way the app does, then splits it. */
function quoteAndSplit(lines: LineInput[], stateCode: string) {
  const t = calculateTotals(lines, { customerStateCode: stateCode });
  const amounts = lines.map((l) => calculateLine(l).amountPaise);
  const split = splitQuotation(
    { intraState: t.intraState, gstPct: t.gstPct, cgstPaise: t.cgstPaise, sgstPaise: t.sgstPaise, igstPaise: t.igstPaise, grandTotalPaise: t.grandTotalPaise },
    lines.map((l, i) => ({ billableQty: l.billableQty, listRatePaise: l.listRatePaise, amountPaise: amounts[i] })),
  );
  return { t, split };
}
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("splitting a quotation into tickets", () => {
  it("one service: the ticket equals the quotation (₹8,496 case)", () => {
    const pt = priceTypeFor({ category: "MSME", isMcciaMember: true }, DEFAULT_PRICING_SETTINGS);
    const r = customerRate({ rateMsme: 40, rateOem: 80 }, pt);
    const { split } = quoteAndSplit([{ billableQty: 200, listRatePaise: r.listRatePaise, discountPct: 10 }], "27");
    expect(split).toHaveLength(1);
    expect(split[0]).toMatchObject({ listPaise: 800000, discountPaise: 80000, taxablePaise: 720000, cgstPaise: 64800, sgstPaise: 64800, totalPaise: 849600 });
  });

  it("three services with member discount and round off add up exactly", () => {
    const lines: LineInput[] = [
      { billableQty: 48, listRatePaise: toPaise(220), discountPct: 10 },
      { billableQty: 5, listRatePaise: toPaise(2100), discountPct: 10 },
      { billableQty: 37.5, listRatePaise: toPaise(55), discountPct: 10 },
    ];
    const { t, split } = quoteAndSplit(lines, "27");
    expect(split).toHaveLength(3);
    expect(sum(split.map((s) => s.listPaise))).toBe(t.subtotalPaise);
    expect(sum(split.map((s) => s.discountPaise))).toBe(t.discountPaise);
    expect(sum(split.map((s) => s.taxablePaise))).toBe(t.taxablePaise);
    expect(sum(split.map((s) => s.cgstPaise))).toBe(t.cgstPaise);
    expect(sum(split.map((s) => s.sgstPaise))).toBe(t.sgstPaise);
    expect(sum(split.map((s) => s.totalPaise))).toBe(t.grandTotalPaise);
    // only the last ticket carries the round off
    expect(split[0].roundOffPaise).toBe(0);
    expect(split[1].roundOffPaise).toBe(0);
    expect(split[2].roundOffPaise).toBe(t.roundOffPaise);
  });

  it("IGST quotations (outside Maharashtra) split exactly too", () => {
    const lines: LineInput[] = [
      { billableQty: 6, listRatePaise: toPaise(2000), discountPct: 0 },
      { billableQty: 2.5, listRatePaise: toPaise(400), discountPct: 0 },
      { billableQty: 1, listRatePaise: toPaise(333.33), discountPct: 0 },
    ];
    const { t, split } = quoteAndSplit(lines, "29");
    expect(split.every((s) => s.cgstPaise === 0 && s.sgstPaise === 0)).toBe(true);
    expect(sum(split.map((s) => s.igstPaise))).toBe(t.igstPaise);
    expect(sum(split.map((s) => s.totalPaise))).toBe(t.grandTotalPaise);
  });

  it("random quotations always add up to the paisa", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let n = 0; n < 300; n++) {
      const lines: LineInput[] = Array.from({ length: 1 + Math.floor(rnd() * 6) }, () => ({
        billableQty: Math.round(rnd() * 5000) / 10,
        listRatePaise: Math.round(rnd() * 300000),
        discountPct: rnd() < 0.5 ? 10 : 0,
      }));
      const { t, split } = quoteAndSplit(lines, rnd() < 0.5 ? "27" : "33");
      expect(sum(split.map((s) => s.totalPaise))).toBe(t.grandTotalPaise);
      expect(sum(split.map((s) => s.taxablePaise))).toBe(t.taxablePaise);
      expect(sum(split.map((s) => s.cgstPaise + s.sgstPaise + s.igstPaise))).toBe(t.cgstPaise + t.sgstPaise + t.igstPaise);
    }
  });
});

describe("moving cards", () => {
  it("moves one step forward or back only", () => {
    expect(moveKind("WAITING_PO", "BILLING")).toBe("forward");
    expect(moveKind("BILLING", "WAITING_PO")).toBe("back");
    expect(moveKind("WAITING_PO", "PAYMENT")).toBe("invalid");
    expect(moveKind("WAITING_PO", "PAID")).toBe("invalid");
    expect(moveKind("PAID", "PAYMENT")).toBe("invalid");
    expect(moveProblem("WAITING_PO", "PAYMENT")).toMatch(/can't skip a step/);
    expect(moveProblem("BILLING", "PAYMENT")).toBeNull();
  });
});

describe("dates in India time", () => {
  it("uses Asia/Kolkata, not the server's clock", () => {
    // 20:00 UTC on 18 Nov is already 19 Nov in India (01:30 IST)
    expect(todayInIndia(new Date("2026-11-18T20:00:00Z"))).toBe("2026-11-19");
    expect(todayInIndia(new Date("2026-11-18T18:00:00Z"))).toBe("2026-11-18");
  });
  it("counts days and adds credit days", () => {
    expect(daysBetween("2026-11-19", "2026-11-24")).toBe(5);
    expect(daysBetween("2026-03-30", "2026-04-02")).toBe(3);
    expect(addDays("2026-11-19", 30)).toBe("2026-12-19");
    expect(addDays("2027-01-31", 30)).toBe("2027-03-02");
  });
  it("shows the due chip", () => {
    expect(dueChip("2026-11-24", "2026-11-19")).toMatchObject({ label: "Due in 5 days", tone: "grey" });
    expect(dueChip("2026-11-20", "2026-11-19")).toMatchObject({ label: "Due in 1 day" });
    expect(dueChip("2026-11-19", "2026-11-19")).toMatchObject({ label: "Due today", tone: "amber" });
    expect(dueChip("2026-11-07", "2026-11-19")).toMatchObject({ label: "Overdue by 12 days", tone: "red", daysOverdue: 12 });
  });
  it("adds a part-paid chip", () => {
    const chips = invoiceChips({ dueDate: "2026-11-07", amountPaise: toPaise(10000), leftPaise: toPaise(4000) }, "2026-11-19");
    expect(chips.map((c) => c.label)).toEqual(["Overdue by 12 days", "Part paid: ₹4,000 left"]);
    expect(invoiceChips({ dueDate: "2026-11-07", amountPaise: 100, leftPaise: 0 }, "2026-11-19")[0].label).toBe("Paid");
  });
});

describe("payments", () => {
  it("amount left = invoice - payments - TDS", () => {
    expect(amountLeft({ amountPaise: toPaise(11800), payments: [{ amountPaise: toPaise(5000), tdsPaise: toPaise(200) }] })).toBe(toPaise(6600));
    expect(amountLeft({ amountPaise: toPaise(100), payments: [{ amountPaise: toPaise(100), tdsPaise: 0 }] })).toBe(0);
  });
  it("blocks overpaying", () => {
    expect(paymentProblem(toPaise(6600), toPaise(6600), 0)).toBeNull();
    expect(paymentProblem(toPaise(6600), toPaise(6500), toPaise(200))).toMatch(/more than the amount left/);
    expect(paymentProblem(toPaise(6600), 0, 0)).toMatch(/enter the amount/);
  });
});

describe("follow-up due today", () => {
  const base = { dueDate: "2026-11-07", leftPaise: 100, nextFollowUpDate: null, lastContactDate: null };
  it("overdue with no recent contact", () => expect(followUpDue(base, "2026-11-19")).toBe(true));
  it("overdue but contacted 3 days ago", () => expect(followUpDue({ ...base, lastContactDate: "2026-11-16" }, "2026-11-19")).toBe(false));
  it("next follow-up date reached", () => expect(followUpDue({ ...base, dueDate: "2026-12-30", nextFollowUpDate: "2026-11-19" }, "2026-11-19")).toBe(true));
  it("not yet due and no follow-up date", () => expect(followUpDue({ ...base, dueDate: "2026-12-30" }, "2026-11-19")).toBe(false));
  it("paid invoices never need follow-up", () => expect(followUpDue({ ...base, leftPaise: 0 }, "2026-11-19")).toBe(false));
});

describe("PO amount check and reminder text", () => {
  it("accepts either before-GST or with-GST amount", () => {
    expect(poAmountMatches(toPaise(7200), toPaise(7200), toPaise(8496))).toBe(true);
    expect(poAmountMatches(toPaise(8496), toPaise(7200), toPaise(8496))).toBe(true);
    expect(poAmountMatches(toPaise(8000), toPaise(7200), toPaise(8496))).toBe(false);
  });
  it("fills the WhatsApp template", () => {
    const text = fillTemplate(DEFAULT_WHATSAPP_TEMPLATE, {
      company: "Sahyadri", contact_name: "Rohan Kulkarni", invoice_no: "INV-123", invoice_date: "19 Nov 2026",
      amount_due: "8,496.00", due_date: "19 Dec 2026", days_overdue: "0",
    });
    expect(text).toBe(
      "Dear Rohan Kulkarni, this is a gentle reminder from AutoCluster, Pune. Invoice INV-123 dated 19 Nov 2026 for ₹8,496.00 is due on 19 Dec 2026. Kindly arrange the payment. Thank you.",
    );
  });
});
