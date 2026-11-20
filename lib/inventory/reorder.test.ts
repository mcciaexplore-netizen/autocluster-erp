import { describe, expect, it } from "vitest";
import { orderItemsText, orderLinks, orderQtyText, suggestedQty } from "./reorder";

describe("reorder", () => {
  it("suggests the reorder quantity, rounded up to whole packs", () => {
    expect(suggestedQty({ qty: "800", reorderLevel: "1000", reorderQty: "3000", packSize: "1000" })).toBe("3000");
    expect(suggestedQty({ qty: "800", reorderLevel: "1000", reorderQty: "2500", packSize: "1000" })).toBe("3000");
    expect(suggestedQty({ qty: "40", reorderLevel: "100", reorderQty: "500" })).toBe("500");
  });
  it("without a reorder quantity, brings stock up to twice the reorder level", () => {
    expect(suggestedQty({ qty: "40", reorderLevel: "100", reorderQty: "0" })).toBe("160");
    expect(suggestedQty({ qty: "40", reorderLevel: "100", reorderQty: "0", packSize: "100" })).toBe("200");
    expect(suggestedQty({ qty: "5", reorderLevel: "0", reorderQty: "0" })).toBe("0");
  });
  it("writes quantities in packs when they are whole packs", () => {
    expect(orderQtyText({ name: "SLA resin", qty: "3000", unit: "ml", packName: "Bottle", packSize: "1000" })).toBe("3 bottles of 1,000 ml (3,000 ml)");
    expect(orderQtyText({ name: "SLA resin", qty: "1000", unit: "ml", packName: "Bottle", packSize: "1000" })).toBe("1 bottle of 1,000 ml (1,000 ml)");
    expect(orderQtyText({ name: "SLA resin", qty: "1500", unit: "ml", packName: "Bottle", packSize: "1000" })).toBe("1,500 ml");
    expect(orderQtyText({ name: "Gloves", qty: "500", unit: "pcs" })).toBe("500 pcs");
  });
  it("builds the WhatsApp and email links from the templates", () => {
    const lines = [
      { name: "SLA resin, imported (grey)", qty: "3000", unit: "ml", packName: "Bottle", packSize: "1000" },
      { name: "Nitrile gloves", qty: "500", unit: "pcs" },
    ];
    expect(orderItemsText(lines)).toBe("1. SLA resin, imported (grey): 3 bottles of 1,000 ml (3,000 ml)\n2. Nitrile gloves: 500 pcs");
    const l = orderLinks(
      { name: "Deccan Resins & Polymers", contactName: "Mr. Kale", phone: "98220 11111", email: "sales@deccan.example" },
      lines,
      { whatsapp: "Dear {contact_name},\n{items}\n{org_name}", emailSubject: "Order ({date})", emailBody: "{items}" },
      { orgName: "ACDRI", date: "20 Nov 2026" },
    );
    expect(l.message).toBe("Dear Mr. Kale,\n1. SLA resin, imported (grey): 3 bottles of 1,000 ml (3,000 ml)\n2. Nitrile gloves: 500 pcs\nACDRI");
    expect(l.whatsappUrl).toBe(`https://wa.me/919822011111?text=${encodeURIComponent(l.message)}`);
    expect(l.mailtoUrl).toBe(`mailto:sales@deccan.example?subject=${encodeURIComponent("Order (20 Nov 2026)")}&body=${encodeURIComponent(l.body)}`);
    const none = orderLinks({ name: "LabChem", contactName: null, phone: "020 2567", email: null }, lines, { whatsapp: "Dear {contact_name}", emailSubject: "", emailBody: "" }, { orgName: "", date: "" });
    expect(none).toMatchObject({ message: "Dear LabChem team", whatsappUrl: null, mailtoUrl: null });
  });
});
