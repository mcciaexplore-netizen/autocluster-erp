import { describe, expect, it } from "vitest";
import { checkItemRows, itemColumnForHeader, type ItemImportLists } from "./import";

const lists: ItemImportLists = {
  categories: [{ id: "c1", name: "Raw material" }, { id: "c2", name: "Consumable" }],
  units: [{ id: "u1", name: "ml" }, { id: "u2", name: "pcs" }],
  suppliers: [{ id: "s1", name: "Deccan Resins & Polymers" }],
  departments: [{ code: "RPT", name: "Rapid Prototyping" }, { code: "ENV", name: "Environmental testing" }],
  existingNames: new Set(["nitrile gloves"]),
  existingCodes: new Set(["ITM-0001"]),
};
const ok = { name: "SLA resin, imported (grey)", category: "raw material", unit: "ML", reorderLevel: "1000", reorderQty: "3000" };

describe("item import", () => {
  it("matches headers loosely", () => {
    expect(itemColumnForHeader("Item name *")).toBe("name");
    expect(itemColumnForHeader("Rate per unit before GST (₹)")).toBe("openingRate");
    expect(itemColumnForHeader("Expiry")).toBe("expiryDate");
  });

  it("a good row becomes item form values, with opening stock in batches", () => {
    const [r] = checkItemRows([{ rowNo: 3, raw: { ...ok, departments: "rpt, Environmental testing", supplier: "deccan resins & polymers", trackBatches: "yes", packName: "Bottle", packSize: "1000", openingQty: "2,000", openingRate: "₹4.50", batchNo: "R-11", expiryDate: "31/03/2027" } }], lists);
    expect(r.problems).toEqual([]);
    expect(r.input).toMatchObject({ name: "SLA resin, imported (grey)", categoryId: "c1", unitId: "u1", deptCodes: ["RPT", "ENV"], preferredSupplierId: "s1", trackBatches: true, packName: "Bottle" });
    expect(r.opening).toEqual({ qty: "2000", rate: "4.5", batchNo: "R-11", expiryDate: "2027-03-31" });
  });

  it("problems are listed in plain words, each starting with the row", () => {
    const [r] = checkItemRows([{ rowNo: 4, raw: { name: "Nitrile Gloves", category: "Spares", unit: "box", reorderLevel: "ten", reorderQty: "500", supplier: "Unknown Co", code: "itm-0001" } }], lists);
    expect(r.input).toBeNull();
    expect(r.problems).toEqual([
      "Row 4: category “Spares” isn't in the list. Use one of: Raw material, Consumable.",
      "Row 4: unit “box” isn't in the list. Use one of: ml, pcs.",
      "Row 4: supplier “Unknown Co” isn't in Suppliers. Add the supplier first, or leave it empty.",
      "Row 4: the reorder level should be a number with up to 3 decimals, e.g. 500 or 2.5.",
      "Row 4: there is already an item called “Nitrile Gloves”.",
      "Row 4: item code ITM-0001 is already used. Leave it empty for the next number.",
    ]);
  });

  it("opening stock needs a rate, and a batch and expiry when the item tracks batches", () => {
    const rows = checkItemRows(
      [
        { rowNo: 3, raw: { ...ok, trackBatches: "Yes", openingQty: "500" } },
        { rowNo: 4, raw: { ...ok, name: "Wipes", unit: "pcs", openingQty: "100", openingRate: "2", batchNo: "B1" } },
        { rowNo: 5, raw: { ...ok, name: "Tape", unit: "pcs", openingRate: "30" } },
        { rowNo: 6, raw: { ...ok, name: "wipes", unit: "pcs", openingQty: "0" } },
      ],
      lists,
    );
    expect(rows[0].problems).toEqual([
      "Row 3: opening stock needs the rate per ml before GST, e.g. 4.50.",
      "Row 3: this item tracks batches, so the opening stock needs a batch number.",
      "Row 3: this item tracks batches, so the opening stock needs an expiry date, e.g. 31/03/2027.",
    ]);
    expect(rows[1].problems).toEqual(["Row 4: a batch number or expiry date is only used when Track batches is Yes."]);
    expect(rows[2].problems).toEqual(["Row 5: a rate, batch number or expiry date was given without an opening stock quantity."]);
    expect(rows[3].problems).toEqual(["Row 6: the first row for “wipes” (row 4) has problems. Fix that row first."]);
  });

  it("the same item on several rows: the first row creates it, later rows each add a batch", () => {
    const base = { ...ok, trackBatches: "Yes", openingRate: "4.5" };
    const rows = checkItemRows(
      [
        { rowNo: 3, raw: { ...base, openingQty: "1000", batchNo: "A1", expiryDate: "30/06/2027" } },
        { rowNo: 4, raw: { name: "sla resin, imported (grey)", openingQty: "500", openingRate: "5", batchNo: "A2", expiryDate: "31/08/2027" } },
        { rowNo: 5, raw: { ...base, reorderLevel: "1000.000", openingQty: "300", batchNo: "A3", expiryDate: "30/09/2027" } },
        { rowNo: 6, raw: { ...base, unit: "pcs", reorderQty: "999", openingQty: "1", batchNo: "A4", expiryDate: "30/09/2027" } },
        { rowNo: 7, raw: { ...base, openingQty: "2", batchNo: "a1", expiryDate: "30/09/2027" } },
        { rowNo: 8, raw: { ...base } },
        { rowNo: 9, raw: { name: "Gloves", category: "Consumable", unit: "pcs", reorderLevel: "1", reorderQty: "1" } },
        { rowNo: 10, raw: { name: "Gloves", openingQty: "5", openingRate: "2" } },
      ],
      lists,
    );
    expect(rows.map((r) => [r.rowNo, !!r.input, r.addsTo])).toEqual([[3, true, null], [4, false, 3], [5, false, 3], [6, false, null], [7, false, null], [8, false, null], [9, true, null], [10, false, null]]);
    expect(rows[1].opening).toEqual({ qty: "500", rate: "5", batchNo: "A2", expiryDate: "2027-08-31" });
    expect(rows[3].problems).toEqual(["Row 6: the item details don't match row 3 (Unit, Reorder quantity). Make them the same, or leave them empty on this row."]);
    expect(rows[4].problems).toEqual(["Row 7: batch a1 of “SLA resin, imported (grey)” is also on row 3. Use one row per batch."]);
    expect(rows[5].problems).toEqual(["Row 8: “SLA resin, imported (grey)” is already on row 3, so this row only adds opening stock for another batch. Please enter the quantity."]);
    expect(rows[7].problems).toEqual(["Row 10: “Gloves” is already on row 9. The same item can only be on several rows when it tracks batches (one row per batch)."]);
  });
});
