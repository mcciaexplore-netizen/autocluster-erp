/** Read-only queries for the Orders & Billing board. */
import "server-only";
import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import { moneyView, need } from "@/lib/auth/guard";
import { blankKeys } from "@/lib/auth/redact";
import { hideRupees } from "@/lib/money-text";
import { connection } from "next/server";
import { db } from "@/db";
import {
  customers,
  files,
  followUps,
  invoices,
  payments,
  purchaseOrders,
  quotationItems,
  quotations,
  services,
  ticketEvents,
  tickets,
  type TicketStage,
} from "@/db/schema";
import { getServiceMaterials, getTicketMaterials } from "@/lib/inventory-data";
import { stockHint, suggestMaterials } from "@/lib/inventory/materials";
import { toPaise } from "@/lib/pricing";
import { amountLeft, daysBetween, todayInIndia } from "@/lib/tickets";

export interface BoardInvoice {
  id: string;
  number: string;
  date: string;
  dueDate: string;
  creditDays: number;
  /** Money fields are null for people who may not see sale prices. */
  amountPaise: number | null;
  leftPaise: number | null;
  /** Something is still to be paid (kept even when the amounts are hidden). */
  balanceDue: boolean;
  paidPaise: number | null;
  tdsPaise: number | null;
  ticketCount: number;
  fileId: string | null;
  nextFollowUpDate: string | null;
  lastContactDate: string | null;
}

export interface BoardTicket {
  id: string;
  ticketNo: string;
  quoteNo: string;
  quotationId: string;
  customerId: string;
  companyName: string;
  description: string;
  deptCode: string | null;
  quantityText: string;
  /** Sale prices: null for people who may not see them (removed on the server). */
  listPaise: number | null;
  discountPaise: number | null;
  taxablePaise: number | null;
  gstPaise: number | null;
  totalPaise: number | null;
  stage: TicketStage;
  stageChangedAt: string;
  cancelReason: string | null;
  contact: { name: string; phone: string; email: string; creditDays: number; gstin: string | null };
  po: { id: string; number: string; date: string; amountPaise: number | null; fileId: string | null } | null;
  invoice: BoardInvoice | null;
  /** Inventory: stock used for this job (net of reversals), and whether its service has a materials list. */
  materialsRecorded: boolean;
  /** Stock cost: null for people who may not see stock costs. */
  materialCostPaise: number | null;
  hasMaterialsList: boolean;
  /** Planning: the ticket's job, and its first booking still to come (or the latest). */
  job: { id: string; status: string; bookedOn: string | null; machine: string | null; checkWorkDone: boolean } | null;
}

/** Last time someone contacted the customer about each invoice (note or reminder), as YYYY-MM-DD in India time. */
async function lastContactByInvoice(invoiceIds: string[]) {
  if (!invoiceIds.length) return new Map<string, string>();
  const rows = await db.execute<{ invoice_id: string; last: string }>(sql`
    select invoice_id, max(d)::text as last from (
      select invoice_id, (created_at at time zone 'Asia/Kolkata')::date as d from follow_ups where invoice_id = any(${sql.param(invoiceIds)}::uuid[])
      union all
      select t.invoice_id, (e.created_at at time zone 'Asia/Kolkata')::date from ticket_events e join tickets t on t.id = e.ticket_id
       where e.type in ('REMINDER_WHATSAPP','REMINDER_EMAIL') and t.invoice_id = any(${sql.param(invoiceIds)}::uuid[])
    ) x group by invoice_id`);
  return new Map(rows.rows.map((r) => [r.invoice_id, r.last]));
}

export async function invoiceSummaries(invoiceIds: string[]): Promise<Map<string, BoardInvoice>> {
  await connection();
  await need();
  const ids = [...new Set(invoiceIds)].filter((i) => /^[0-9a-f-]{36}$/i.test(i));
  if (!ids.length) return new Map();
  const [inv, pays, counts, nextFu, lastContact] = await Promise.all([
    db.select().from(invoices).where(inArray(invoices.id, ids)),
    db.select().from(payments).where(inArray(payments.invoiceId, ids)),
    db
      .select({ invoiceId: tickets.invoiceId, n: sql<number>`count(*)::int` })
      .from(tickets)
      .where(inArray(tickets.invoiceId, ids))
      .groupBy(tickets.invoiceId),
    db
      .select({ invoiceId: followUps.invoiceId, next: followUps.nextFollowUpDate })
      .from(followUps)
      .where(inArray(followUps.invoiceId, ids))
      .orderBy(desc(followUps.createdAt)),
    lastContactByInvoice(ids),
  ]);
  const out = new Map<string, BoardInvoice>();
  for (const i of inv) {
    const ps = pays.filter((p) => p.invoiceId === i.id).map((p) => ({ amountPaise: toPaise(p.amount), tdsPaise: toPaise(p.tdsAmount) }));
    const amountPaise = toPaise(i.amount);
    out.set(i.id, {
      id: i.id,
      number: i.invoiceNumber,
      date: i.invoiceDate,
      dueDate: i.dueDate,
      creditDays: i.creditDays,
      amountPaise,
      leftPaise: amountLeft({ amountPaise, payments: ps }),
      balanceDue: amountLeft({ amountPaise, payments: ps }) > 0,
      paidPaise: ps.reduce((s, p) => s + p.amountPaise, 0),
      tdsPaise: ps.reduce((s, p) => s + p.tdsPaise, 0),
      ticketCount: counts.find((c) => c.invoiceId === i.id)?.n ?? 0,
      fileId: i.fileId,
      // the most recent note decides the next follow-up date
      nextFollowUpDate: nextFu.find((f) => f.invoiceId === i.id)?.next ?? null,
      lastContactDate: lastContact.get(i.id) ?? null,
    });
  }
  return out;
}

export async function getBoardTickets(customerId?: string): Promise<BoardTicket[]> {
  await connection();
  const me = await need(["orders.view", "customers.view"]);
  const { sale, stock } = moneyView(me);
  const m = <T,>(v: T) => (sale ? v : null);
  const rows = await db
    .select({
      t: tickets,
      c: {
        name: customers.pocName,
        phone: customers.pocPhone,
        email: customers.pocEmail,
        creditDays: customers.creditDays,
        gstin: customers.gstin,
      },
      po: {
        id: purchaseOrders.id,
        number: purchaseOrders.poNumber,
        date: purchaseOrders.poDate,
        amount: purchaseOrders.poAmount,
        fileId: purchaseOrders.fileId,
      },
    })
    .from(tickets)
    .innerJoin(customers, eq(customers.id, tickets.customerId))
    .leftJoin(purchaseOrders, eq(purchaseOrders.id, tickets.poId))
    .where(customerId ? eq(tickets.customerId, customerId) : undefined)
    .orderBy(asc(tickets.stageChangedAt), asc(tickets.seq));

  const inv = await invoiceSummaries(rows.map((r) => r.t.invoiceId).filter((x): x is string => !!x));
  const mats = await materialsByTicket();
  const jobRows = await db.execute<{ ticket_id: string; id: string; status: string; check_work_done: boolean; start_at: string | null; machine: string | null }>(sql`
    select j.ticket_id, j.id, j.status, j.check_work_done, b.start_at::text, m.name as machine
    from jobs j
    left join lateral (
      select * from job_bookings b where b.job_id = j.id and b.cancelled_at is null
      order by (b.end_at > now()) desc, case when b.end_at > now() then b.start_at end asc, b.start_at desc limit 1
    ) b on true
    left join machines m on m.id = b.machine_id`);
  const jobOf = new Map(jobRows.rows.map((r) => [r.ticket_id, r]));
  return rows.map(({ t, c, po }) => ({
    id: t.id,
    ticketNo: t.ticketNo,
    quoteNo: t.snapshot.quoteNo,
    quotationId: t.quotationId,
    customerId: t.customerId,
    companyName: t.snapshot.companyName,
    description: t.snapshot.description,
    deptCode: t.snapshot.deptCode,
    quantityText: t.snapshot.quantityText,
    listPaise: m(toPaise(t.listAmount)),
    discountPaise: m(toPaise(t.discountAmount)),
    taxablePaise: m(toPaise(t.taxableValue)),
    gstPaise: m(toPaise(t.cgst) + toPaise(t.sgst) + toPaise(t.igst)),
    totalPaise: m(toPaise(t.totalAmount)),
    stage: t.stage,
    stageChangedAt: t.stageChangedAt.toISOString(),
    cancelReason: t.cancelReason,
    contact: c,
    po: po?.id ? { id: po.id, number: po.number!, date: po.date!, amountPaise: m(toPaise(po.amount!)), fileId: po.fileId } : null,
    invoice: t.invoiceId ? hideInvoiceMoney(inv.get(t.invoiceId) ?? null, sale) : null,
    materialsRecorded: mats.recorded.has(t.id),
    materialCostPaise: stock ? (mats.cost.get(t.id) ?? 0) : null,
    hasMaterialsList: mats.withList.has(t.quotationItemId),
    job: (() => {
      const j = jobOf.get(t.id);
      return j ? { id: j.id, status: j.status, bookedOn: j.start_at, machine: j.machine, checkWorkDone: j.check_work_done } : null;
    })(),
  }));
}

/** An invoice without amounts, for people who may not see sale prices. */
function hideInvoiceMoney(i: BoardInvoice | null, sale: boolean): BoardInvoice | null {
  return !i || sale ? i : { ...i, amountPaise: null, leftPaise: null, paidPaise: null, tdsPaise: null };
}

/** Material cost per ticket (stock used minus reversals), and which ticket lines' services have a materials list. */
async function materialsByTicket() {
  const [costs, lists] = await Promise.all([
    db.execute<{ ticket_id: string; cost: string; recorded: boolean }>(sql`
      select d.ticket_id, sum(case when m.qty_out > 0 then m.value else -m.value end) as cost,
        bool_or(d.reverses_doc_id is null and d.reversed_by_doc_id is null) as recorded
      from inv_documents d join inv_movements m on m.document_id = d.id
      where d.ticket_id is not null and d.type = 'OUT'
      group by d.ticket_id`),
    db.execute<{ id: number }>(sql`select qi.id from quotation_items qi where exists (select 1 from inv_service_materials sm where sm.service_id = qi.service_id)`),
  ]);
  return {
    cost: new Map(costs.rows.map((r) => [r.ticket_id, Number(r.cost)])),
    recorded: new Set(costs.rows.filter((r) => r.recorded).map((r) => r.ticket_id)),
    withList: new Set(lists.rows.map((r) => r.id)),
  };
}

export async function getTicketDetail(id: string) {
  await connection();
  const me = await need(["orders.view", "planning.view"]);
  const sale = moneyView(me).sale;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [t] = await db.select().from(tickets).where(eq(tickets.id, id));
  if (!t) return null;
  const [events, [quote], po, invoice] = await Promise.all([
    db.select().from(ticketEvents).where(eq(ticketEvents.ticketId, id)).orderBy(desc(ticketEvents.createdAt), desc(ticketEvents.id)),
    db.select({ id: quotations.id, quoteNo: quotations.quoteNo, status: quotations.status }).from(quotations).where(eq(quotations.id, t.quotationId)),
    t.poId ? db.select().from(purchaseOrders).where(eq(purchaseOrders.id, t.poId)).then((r) => r[0] ?? null) : Promise.resolve(null),
    t.invoiceId ? invoiceSummaries([t.invoiceId]).then((m) => m.get(t.invoiceId!) ?? null) : Promise.resolve(null),
  ]);
  const fileIds = [po?.fileId, invoice?.fileId].filter((x): x is string => !!x);
  const fileRows = fileIds.length ? await db.select().from(files).where(inArray(files.id, fileIds)) : [];
  const [pays, notes] = t.invoiceId
    ? await Promise.all([
        db.select().from(payments).where(eq(payments.invoiceId, t.invoiceId)).orderBy(desc(payments.paidOn)),
        db.select().from(followUps).where(eq(followUps.invoiceId, t.invoiceId)).orderBy(desc(followUps.createdAt)),
      ])
    : [[], []];
  const fileInfo = (fid: string | null | undefined) => {
    const f = fileRows.find((x) => x.id === fid);
    return f ? { id: f.id, name: f.fileName, size: f.size } : null;
  };
  const [mats, svcMaterials, svcRow] = await Promise.all([
    getTicketMaterials(id),
    getServiceMaterials(),
    db
      .select({ serviceId: quotationItems.serviceId, noneNeeded: services.noMaterialsNeeded })
      .from(quotationItems)
      .leftJoin(services, eq(services.id, quotationItems.serviceId))
      .where(eq(quotationItems.id, t.quotationItemId)),
  ]);
  const serviceId = svcRow[0]?.serviceId ?? null;
  const suggestions = serviceId ? suggestMaterials(t.snapshot.billableQty, t.snapshot.unitLabel, svcMaterials[serviceId] ?? []) : [];
  // For people who may not see sale prices: no amounts anywhere, not even inside history lines.
  const m = <T,>(v: T) => (sale ? v : null);
  const ticket = sale ? t : blankKeys(t, ["listAmount", "discountAmount", "taxableValue", "cgst", "sgst", "igst", "totalAmount"] as const);
  return {
    materials: {
      ...mats,
      taxablePaise: m(toPaise(t.taxableValue)),
      recorded: mats.docs.some((d) => !d.reverses && !d.reversedBy),
      hint: stockHint(suggestions),
      hasList: suggestions.length > 0,
      /** Rate Card "No materials needed": kept after materials is 100%. */
      noneNeeded: !!svcRow[0]?.noneNeeded && suggestions.length === 0,
    },
    ticket: {
      ...ticket,
      stageChangedAt: t.stageChangedAt.toISOString(),
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    },
    quote: quote ?? null,
    po: po ? { id: po.id, number: po.poNumber, date: po.poDate, amount: m(po.poAmount), notes: po.notes, file: fileInfo(po.fileId) } : null,
    invoice: invoice ? { ...hideInvoiceMoney(invoice, sale)!, file: fileInfo(invoice.fileId) } : null,
    payments: pays.map((p) => ({ ...(sale ? p : blankKeys(p, ["amount", "tdsAmount"] as const)), createdAt: p.createdAt.toISOString() })),
    notes: notes.map((n) => ({ ...n, createdAt: n.createdAt.toISOString() })),
    events: events.map((e) => ({ id: e.id, type: e.type, message: sale ? e.message : hideRupees(e.message), by: e.createdBy, at: e.createdAt.toISOString() })),
  };
}
export type TicketDetail = NonNullable<Awaited<ReturnType<typeof getTicketDetail>>>;

/** Small helper for the home page cards. */
export async function getOrdersStats() {
  await connection();
  const me = await need(["orders.view"]);
  const all = await getBoardTickets();
  const sale = moneyView(me).sale;
  const today = todayInIndia();
  const live = all.filter((t) => t.stage !== "CANCELLED");
  const invoicesSeen = new Map<string, BoardInvoice>();
  for (const t of live) if (t.stage === "PAYMENT" && t.invoice) invoicesSeen.set(t.invoice.id, t.invoice);
  // Amounts only for people who may see sale prices.
  const outstanding = sale ? [...invoicesSeen.values()].reduce((s, i) => s + (i.leftPaise ?? 0), 0) : null;
  const overdue = sale ? [...invoicesSeen.values()].filter((i) => daysBetween(today, i.dueDate) < 0).reduce((s, i) => s + (i.leftPaise ?? 0), 0) : null;
  return {
    waitingPo: live.filter((t) => t.stage === "WAITING_PO").length,
    readyToBill: live.filter((t) => t.stage === "BILLING").length,
    outstandingPaise: outstanding,
    overduePaise: overdue,
  };
}
