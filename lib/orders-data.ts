/** Read-only queries for the Orders & Billing board. */
import "server-only";
import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import { connection } from "next/server";
import { db } from "@/db";
import {
  customers,
  files,
  followUps,
  invoices,
  payments,
  purchaseOrders,
  quotations,
  ticketEvents,
  tickets,
  type TicketStage,
} from "@/db/schema";
import { toPaise } from "@/lib/pricing";
import { amountLeft, daysBetween, todayInIndia } from "@/lib/tickets";

export interface BoardInvoice {
  id: string;
  number: string;
  date: string;
  dueDate: string;
  creditDays: number;
  amountPaise: number;
  leftPaise: number;
  paidPaise: number;
  tdsPaise: number;
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
  listPaise: number;
  discountPaise: number;
  taxablePaise: number;
  gstPaise: number;
  totalPaise: number;
  stage: TicketStage;
  stageChangedAt: string;
  cancelReason: string | null;
  contact: { name: string; phone: string; email: string; creditDays: number; gstin: string | null };
  po: { id: string; number: string; date: string; amountPaise: number; fileId: string | null } | null;
  invoice: BoardInvoice | null;
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

export async function getBoardTickets(): Promise<BoardTicket[]> {
  await connection();
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
    .orderBy(asc(tickets.stageChangedAt), asc(tickets.seq));

  const inv = await invoiceSummaries(rows.map((r) => r.t.invoiceId).filter((x): x is string => !!x));
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
    listPaise: toPaise(t.listAmount),
    discountPaise: toPaise(t.discountAmount),
    taxablePaise: toPaise(t.taxableValue),
    gstPaise: toPaise(t.cgst) + toPaise(t.sgst) + toPaise(t.igst),
    totalPaise: toPaise(t.totalAmount),
    stage: t.stage,
    stageChangedAt: t.stageChangedAt.toISOString(),
    cancelReason: t.cancelReason,
    contact: c,
    po: po?.id ? { id: po.id, number: po.number!, date: po.date!, amountPaise: toPaise(po.amount!), fileId: po.fileId } : null,
    invoice: t.invoiceId ? (inv.get(t.invoiceId) ?? null) : null,
  }));
}

export async function getTicketDetail(id: string) {
  await connection();
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
  return {
    ticket: {
      ...t,
      stageChangedAt: t.stageChangedAt.toISOString(),
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    },
    quote: quote ?? null,
    po: po ? { id: po.id, number: po.poNumber, date: po.poDate, amount: po.poAmount, notes: po.notes, file: fileInfo(po.fileId) } : null,
    invoice: invoice ? { ...invoice, file: fileInfo(invoice.fileId) } : null,
    payments: pays.map((p) => ({ ...p, createdAt: p.createdAt.toISOString() })),
    notes: notes.map((n) => ({ ...n, createdAt: n.createdAt.toISOString() })),
    events: events.map((e) => ({ id: e.id, type: e.type, message: e.message, by: e.createdBy, at: e.createdAt.toISOString() })),
  };
}
export type TicketDetail = NonNullable<Awaited<ReturnType<typeof getTicketDetail>>>;

/** Small helper for the home page cards. */
export async function getOrdersStats() {
  const all = await getBoardTickets();
  const today = todayInIndia();
  const live = all.filter((t) => t.stage !== "CANCELLED");
  const invoicesSeen = new Map<string, BoardInvoice>();
  for (const t of live) if (t.stage === "PAYMENT" && t.invoice) invoicesSeen.set(t.invoice.id, t.invoice);
  const outstanding = [...invoicesSeen.values()].reduce((s, i) => s + i.leftPaise, 0);
  const overdue = [...invoicesSeen.values()].filter((i) => daysBetween(today, i.dueDate) < 0).reduce((s, i) => s + i.leftPaise, 0);
  return {
    waitingPo: live.filter((t) => t.stage === "WAITING_PO").length,
    readyToBill: live.filter((t) => t.stage === "BILLING").length,
    outstandingPaise: outstanding,
    overduePaise: overdue,
  };
}
