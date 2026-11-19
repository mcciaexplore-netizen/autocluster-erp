/**
 * Billing export. `exportBilling(tickets)` is the one entry point the app uses.
 * Today it produces the manual Excel file; when TallyPrime access is available,
 * add a `tallyExporter` (method "TALLY") and pick it in `currentExporter()`.
 * Plain module (no Next.js imports) so scripts and tests can use it.
 */
import { asc, eq, inArray } from "drizzle-orm";
import type { DB, Tx } from "../../db/client";
import { UserFacingError } from "../../db/quote-writer";
import { billingExports, customers, purchaseOrders, tickets } from "../../db/schema";
import { addEvents } from "../../db/ticket-writer";
import { toPaise } from "../pricing";
import { excelExporter } from "./excel";
import type { BillingDocument, BillingExporter, ExportResult } from "./types";

export type { BillingDocument, BillingExporter, ExportResult } from "./types";

/** Tally isn't connected yet (shown in Settings as "coming soon"). */
export const TALLY_CONNECTION = { connected: false as const, label: "Not connected (coming soon)" };

export function currentExporter(): BillingExporter {
  return excelExporter;
}

export async function buildBillingDocument(conn: DB | Tx, ticketIds: string[], today: string): Promise<BillingDocument> {
  const ids = [...new Set(ticketIds)];
  if (!ids.length) throw new UserFacingError("Please tick at least one service.");
  const rows = await conn
    .select({ t: tickets, c: customers, po: { number: purchaseOrders.poNumber, date: purchaseOrders.poDate } })
    .from(tickets)
    .innerJoin(customers, eq(customers.id, tickets.customerId))
    .leftJoin(purchaseOrders, eq(purchaseOrders.id, tickets.poId))
    .where(inArray(tickets.id, ids))
    .orderBy(asc(tickets.seq));
  if (rows.length !== ids.length) throw new UserFacingError("Some of these tickets could not be found. Please refresh the page.");
  const c = rows[0].c;
  if (rows.some((r) => r.c.id !== c.id)) throw new UserFacingError("One invoice can only cover services of the same customer.");
  const notReady = rows.filter((r) => r.t.stage !== "BILLING");
  if (notReady.length) throw new UserFacingError(`${notReady.map((r) => r.t.ticketNo).join(", ")} ${notReady.length === 1 ? "is" : "are"} not in Billing any more. Please refresh the page.`);

  const lines = rows.map(({ t }) => ({
    ticketNo: t.ticketNo,
    quoteNo: t.snapshot.quoteNo,
    deptCode: t.snapshot.deptCode,
    description: t.snapshot.description,
    quantityText: t.snapshot.quantityText,
    billableQty: Number(t.snapshot.billableQty),
    unitLabel: t.snapshot.unitLabel,
    listRatePaise: toPaise(t.snapshot.listRate),
    finalRatePaise: toPaise(t.snapshot.finalRate),
    discountPct: Number(t.snapshot.discountPct),
    listAmountPaise: toPaise(t.listAmount),
    discountPaise: toPaise(t.discountAmount),
    taxablePaise: toPaise(t.taxableValue),
    cgstPaise: toPaise(t.cgst),
    sgstPaise: toPaise(t.sgst),
    igstPaise: toPaise(t.igst),
    roundOffPaise: toPaise(t.snapshot.roundOff ?? "0"),
    totalPaise: toPaise(t.totalAmount),
  }));
  const sum = (k: keyof (typeof lines)[number]) => lines.reduce((s, l) => s + (l[k] as number), 0);
  const uniq = <T,>(xs: T[]) => [...new Set(xs)];
  const pos = new Map<string, { number: string; date: string }>();
  for (const r of rows) if (r.po?.number) pos.set(r.po.number, { number: r.po.number, date: r.po.date! });

  return {
    customer: {
      companyName: c.companyName,
      gstin: c.gstRegistered ? c.gstin : null,
      address: [c.addressLine1, c.addressLine2, `${c.city} - ${c.pincode}`].filter(Boolean).join(", "),
      state: c.state,
      stateCode: c.stateCode,
      pocName: c.pocName,
      pocEmail: c.pocEmail,
      pocPhone: c.pocPhone,
    },
    pos: [...pos.values()],
    quoteNos: uniq(rows.map((r) => r.t.snapshot.quoteNo)),
    ticketNos: rows.map((r) => r.t.ticketNo),
    ticketIds: rows.map((r) => r.t.id),
    intraState: rows[0].t.snapshot.intraState,
    gstPct: Number(rows[0].t.snapshot.gstPct),
    lines,
    totals: {
      listPaise: sum("listAmountPaise"),
      discountPaise: sum("discountPaise"),
      taxablePaise: sum("taxablePaise"),
      cgstPaise: sum("cgstPaise"),
      sgstPaise: sum("sgstPaise"),
      igstPaise: sum("igstPaise"),
      roundOffPaise: sum("roundOffPaise"),
      totalPaise: sum("totalPaise"),
    },
    preparedOn: today,
  };
}

/** Builds the billing details, runs the current exporter and logs it on every ticket. */
export async function exportBilling(db: DB, ticketIds: string[], today: string): Promise<ExportResult> {
  const doc = await buildBillingDocument(db, ticketIds, today);
  const exporter = currentExporter();
  const result = await exporter.exportBilling(doc);
  await db.transaction(async (tx) => {
    await tx.insert(billingExports).values({ ticketIds: doc.ticketIds, method: exporter.method, status: "DONE" });
    const others = doc.ticketNos.length > 1 ? ` (together with ${doc.ticketNos.length - 1} more)` : "";
    await addEvents(
      tx,
      doc.ticketIds,
      "BILLING_EXPORTED",
      exporter.method === "EXCEL_MANUAL" ? `Billing details downloaded (Excel)${others}` : `Sent to TallyPrime${others}`,
      { method: exporter.method, ticketNos: doc.ticketNos },
    );
  });
  return result;
}
