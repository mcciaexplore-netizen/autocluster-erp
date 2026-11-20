import type { Metadata } from "next";
import { ArrowLeft, Mail, MessageCircle, Package, Pencil, Phone } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { FormSkeleton } from "@/components/common/form-skeleton";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { getInvSupplier } from "@/lib/inventory-data";
import { formatRate } from "@/lib/inventory/numbers";
import { UUID_RE } from "@/lib/inventory/uuid";
import { formatINRShort } from "@/lib/pricing";
import { whatsappNumber } from "@/lib/reminders";

export const metadata: Metadata = { title: "Supplier" };

export default function SupplierPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2">
        <Link href="/inventory/suppliers">
          <ArrowLeft aria-hidden /> All suppliers
        </Link>
      </Button>
      <Suspense fallback={<FormSkeleton />}>
        <Detail params={params} />
      </Suspense>
    </div>
  );
}

async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const d = await getInvSupplier(id);
  if (!d) notFound();
  const s = d.supplier;
  const wa = s.phone ? whatsappNumber(s.phone) : null;
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 className="font-title text-3xl text-primary md:text-4xl">{s.name}</h1>
          <p className="mt-1 text-muted-foreground">
            {[s.contactName, s.gstin ? `GSTIN ${s.gstin}` : null].filter(Boolean).join(" · ") || "No contact person"}
            {!s.isActive ? " · Inactive" : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {wa ? (
            <Button asChild variant="outline">
              <a href={`tel:+${wa}`}>
                <Phone aria-hidden /> Call
              </a>
            </Button>
          ) : null}
          {wa ? (
            <Button asChild variant="outline">
              <a href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer">
                <MessageCircle aria-hidden /> WhatsApp
              </a>
            </Button>
          ) : null}
          {s.email ? (
            <Button asChild variant="outline">
              <a href={`mailto:${s.email}`}>
                <Mail aria-hidden /> Email
              </a>
            </Button>
          ) : null}
          <Button asChild variant="outline">
            <Link href={`/inventory/suppliers/${s.id}/edit`}>
              <Pencil aria-hidden /> Edit
            </Link>
          </Button>
        </div>
      </header>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="Summary">
        <div className="rounded-2xl border bg-card p-4">
          <p className="text-sm text-muted-foreground">Bought this financial year</p>
          <p className="mt-1 text-xl font-semibold text-primary tabular-nums">{formatINRShort(d.summary.boughtThisYearPaise)}</p>
          <p className="text-xs text-muted-foreground">before GST</p>
        </div>
        <div className="rounded-2xl border bg-card p-4">
          <p className="text-sm text-muted-foreground">Items supplied</p>
          <p className="mt-1 text-xl font-semibold text-primary tabular-nums">{d.items.length}</p>
        </div>
        <div className="rounded-2xl border bg-card p-4">
          <p className="text-sm text-muted-foreground">Last delivery</p>
          <p className="mt-1 text-xl font-semibold text-primary">{d.summary.lastReceivedOn ? formatDate(d.summary.lastReceivedOn) : "None yet"}</p>
        </div>
      </section>

      {s.address || s.phone || s.email || s.notes ? (
        <section className="rounded-2xl border bg-card p-5 text-sm">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-[auto_1fr]">
            {s.phone ? (
              <>
                <dt className="text-muted-foreground">Mobile</dt>
                <dd className="tabular-nums">+91 {s.phone}</dd>
              </>
            ) : null}
            {s.email ? (
              <>
                <dt className="text-muted-foreground">Email</dt>
                <dd className="break-all">{s.email}</dd>
              </>
            ) : null}
            {s.address ? (
              <>
                <dt className="text-muted-foreground">Address</dt>
                <dd className="whitespace-pre-wrap">{s.address}</dd>
              </>
            ) : null}
            {s.notes ? (
              <>
                <dt className="text-muted-foreground">Notes</dt>
                <dd className="whitespace-pre-wrap">{s.notes}</dd>
              </>
            ) : null}
          </dl>
        </section>
      ) : null}

      <section className="rounded-2xl border bg-card p-5">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <Package className="size-5 text-primary" aria-hidden /> Items they supply
        </h2>
        {d.items.length ? (
          <ul className="divide-y">
            {d.items.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
                <Link href={`/inventory/items/${i.id}`} className="min-w-0 flex-1 font-medium text-primary hover:underline">
                  {i.name} <span className="text-sm font-normal text-muted-foreground">{i.code}</span>
                </Link>
                <span className="tabular-nums">{i.lastRate ? `${formatRate(i.lastRate)} per ${i.unit}` : "No rate yet"}</span>
                <span className="text-sm text-muted-foreground">
                  {i.lastRateDate ? `last on ${formatDate(i.lastRateDate)}` : ""}
                  {(i.leadTimeDays ?? i.itemLead) != null ? ` · delivers in ${i.leadTimeDays ?? i.itemLead} days` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No items yet. Items appear here once they name this supplier as preferred, or stock is received from them.</p>
        )}
      </section>

      <section className="rounded-2xl border bg-card p-5">
        <h2 className="mb-2 text-lg font-semibold">Stock received from them</h2>
        <p className="text-sm text-muted-foreground">Deliveries from this supplier will be listed here.</p>
      </section>
    </div>
  );
}
