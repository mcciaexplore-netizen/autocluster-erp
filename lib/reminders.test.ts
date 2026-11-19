import { amountForMessage, buildReminder, whatsappNumber } from "./reminders";
import { DEFAULT_EMAIL_BODY_TEMPLATE, DEFAULT_EMAIL_SUBJECT_TEMPLATE, DEFAULT_WHATSAPP_TEMPLATE } from "./reminder-templates";
import { describe, expect, it } from "vitest";

describe("payment reminders", () => {
  it("turns Indian mobile numbers into wa.me numbers", () => {
    expect(whatsappNumber("98220 12345")).toBe("919822012345");
    expect(whatsappNumber("+91-98220-12345")).toBe("919822012345");
    expect(whatsappNumber("09822012345")).toBe("919822012345");
    expect(whatsappNumber("020 2712 0000")).toBeNull();
  });
  it("fills the templates", () => {
    expect(amountForMessage(849600)).toBe("8,496");
    expect(amountForMessage(400050)).toBe("4,000.50");
    const r = buildReminder({
      templates: { whatsapp: DEFAULT_WHATSAPP_TEMPLATE, emailSubject: DEFAULT_EMAIL_SUBJECT_TEMPLATE, emailBody: DEFAULT_EMAIL_BODY_TEMPLATE },
      company: "Sahyadri",
      contactName: "Rohan Kulkarni",
      phone: "9822012345",
      email: "rohan@example.com",
      invoiceNo: "INV-1",
      invoiceDate: "2026-11-10",
      dueDate: "2026-12-10",
      leftPaise: 849600,
      today: "2026-11-19",
    });
    expect(r.message).toBe(
      "Dear Rohan Kulkarni, this is a gentle reminder from AutoCluster, Pune. Invoice INV-1 dated 10 Nov 2026 for ₹8,496 is due on 10 Dec 2026. Kindly arrange the payment. Thank you.",
    );
    expect(r.whatsappUrl).toMatch(/^https:\/\/wa\.me\/919822012345\?text=Dear%20Rohan/);
    expect(r.mailtoUrl).toMatch(/^mailto:rohan@example\.com\?subject=Payment%20reminder/);
    expect(r.mailtoUrl).not.toContain("+");
  });
});
