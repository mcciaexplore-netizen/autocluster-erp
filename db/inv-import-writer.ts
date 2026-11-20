/**
 * Import items from Excel: every good row becomes an item (with the item form's rules), and all
 * opening stock in the file becomes one Stock adjusted record, labelled "Opening stock".
 * One transaction: if anything fails, nothing is saved. Kept free of Next.js imports.
 */
import type { OpeningStock } from "@/lib/inventory/import";
import type { ItemFormValues } from "@/lib/validation/inventory";
import type { DB } from "./client";
import { createItem } from "./inv-master-writer";
import { adjustStock } from "./stock-writer";

export async function importItems(
  db: DB,
  rows: { rowNo: number; input: ItemFormValues; opening: OpeningStock | null }[],
  fileName: string,
  opts: { doneBy?: string | null; today?: string } = {},
) {
  return db.transaction(async (tx) => {
    const made: { rowNo: number; id: string; code: string; name: string }[] = [];
    for (const r of rows) {
      const item = await createItem(tx, r.input);
      made.push({ rowNo: r.rowNo, id: item.id, code: item.code, name: item.name });
    }
    const lines = rows.flatMap((r, i) =>
      r.opening
        ? [{ itemId: made[i].id, direction: "ADD" as const, qty: r.opening.qty, opening: true, unitCost: r.opening.rate, newBatchNo: r.opening.batchNo, newExpiryDate: r.opening.expiryDate }]
        : [],
    );
    const adj = lines.length ? await adjustStock(tx, { doneBy: opts.doneBy, note: `Opening stock imported from Excel (${fileName})`, lines }, { today: opts.today }) : null;
    return { items: made, openingDoc: adj, openingLines: lines.length };
  });
}
