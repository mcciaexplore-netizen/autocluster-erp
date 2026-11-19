import type { QuotationItem } from "@/db/schema";
import { toPaise } from "./pricing";
import type { DraftLine } from "./quote-calc";

/** Turns a saved quotation line back into an editable line, keeping its saved rates. */
export function itemToDraft(it: QuotationItem): DraftLine {
  const n = (v: string | null) => (v == null ? null : Number(v));
  return {
    key: `item-${it.id}`,
    serviceId: it.isCustomItem ? null : it.serviceId,
    deptCode: it.deptCode,
    description: it.description,
    unitType: it.unitType,
    unitLabel: it.unitLabel,
    ccPerPart: n(it.ccPerPart),
    parts: it.parts,
    hours: n(it.hours),
    samples: it.samples,
    quantity: it.isCustomItem ? Number(it.billableQty) : null,
    customRatePaise: it.isCustomItem || it.isCustomRate ? toPaise(it.listRate) : null,
    notes: it.notes,
    locked: it.isCustomItem || it.isCustomRate ? null : { listRatePaise: toPaise(it.listRate), discountPct: Number(it.discountPct) },
  };
}
