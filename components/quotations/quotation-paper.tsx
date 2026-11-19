import { formatDate } from "@/lib/format";
import { formatINR } from "@/lib/pricing";
import type { QuoteView } from "@/lib/quote-view";

/** A4-shaped preview of the quotation, matching the PDF. */
export function QuotationPaper({ view }: { view: QuoteView }) {
  const t = view.totals;
  const c = view.customer;
  const half = t.gstPct / 2;
  return (
    <div className="overflow-x-auto rounded-xl bg-slate-200/60 p-2 sm:p-6 print:bg-white print:p-0">
      <article
        id="quotation-paper"
        className="mx-auto flex min-h-[297mm] w-[210mm] max-w-none flex-col bg-white p-[14mm] text-[12px] leading-snug text-slate-900 shadow-xl print:shadow-none"
        aria-label={`Quotation ${view.quoteNo}`}
      >
        {/* Header */}
        <header className="flex items-start justify-between gap-6 border-b-2 border-[#0B1F3A] pb-4">
          <div className="flex gap-3">
            <div className="grid size-14 shrink-0 place-items-center rounded-lg bg-[#0B1F3A] font-title text-xl text-white">AC</div>
            <div>
              <div className="text-[15px] font-semibold text-[#0B1F3A]">{view.org.name}</div>
              <div className="max-w-[95mm] text-[10.5px] text-slate-600">{view.org.address}</div>
              <div className="text-[10.5px] text-slate-600">
                GSTIN {view.org.gstin} · {view.org.phone} · {view.org.email}
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="font-title text-[30px] leading-none tracking-wide text-[#0B1F3A]">QUOTATION</div>
            <table className="mt-2 ml-auto text-[11px]">
              <tbody>
                <tr>
                  <td className="pr-2 text-slate-500">Quotation no.</td>
                  <td className="font-semibold">{view.quoteNo}</td>
                </tr>
                <tr>
                  <td className="pr-2 text-slate-500">Date</td>
                  <td>{formatDate(view.quoteDate)}</td>
                </tr>
                <tr>
                  <td className="pr-2 text-slate-500">Valid until</td>
                  <td>{formatDate(view.validUntil)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </header>

        {/* To */}
        <section className="mt-4 grid grid-cols-[1fr_auto] gap-6">
          <div>
            <div className="text-[10px] font-semibold tracking-wider text-[#0B1F3A] uppercase">To</div>
            <div className="text-[13px] font-semibold">{c.companyName}</div>
            <div className="text-slate-700">
              {[c.addressLine1, c.addressLine2].filter(Boolean).join(", ")}
              <br />
              {c.city} - {c.pincode}, {c.state}
            </div>
            <div className="mt-1 text-slate-700">
              {c.gstRegistered ? <>GSTIN {c.gstin} · </> : <>Not registered under GST · </>}PAN {c.pan}
            </div>
          </div>
          <div className="text-right text-slate-700">
            <div className="text-[10px] font-semibold tracking-wider text-[#0B1F3A] uppercase">Kind attention</div>
            <div className="font-semibold text-slate-900">{c.pocName}</div>
            {c.pocDesignation ? <div>{c.pocDesignation}</div> : null}
            <div>+91 {c.pocPhone}</div>
            <div>{c.pocEmail}</div>
            {c.isMcciaMember && c.mcciaMembershipId ? <div>MCCIA Membership ID: {c.mcciaMembershipId}</div> : null}
          </div>
        </section>

        <p className="mt-4">
          <span className="font-semibold">Subject: </span>
          {view.subject}
        </p>

        {/* Lines */}
        <table className="mt-3 w-full border-collapse text-[11px]">
          <thead>
            <tr className="bg-[#0B1F3A] text-left text-white">
              <th className="px-2 py-1.5 font-medium">Sr.</th>
              <th className="px-2 py-1.5 font-medium">Dept.</th>
              <th className="px-2 py-1.5 font-medium">Service / description</th>
              <th className="px-2 py-1.5 font-medium">Quantity</th>
              <th className="px-2 py-1.5 font-medium">Unit</th>
              <th className="px-2 py-1.5 text-right font-medium">Rate (₹)</th>
              <th className="px-2 py-1.5 text-right font-medium">Amount (₹)</th>
            </tr>
          </thead>
          <tbody>
            {view.lines.map((l) => (
              <tr key={l.srNo} className="border-b border-slate-200 align-top">
                <td className="px-2 py-1.5">{l.srNo}</td>
                <td className="px-2 py-1.5">{l.deptCode ?? "-"}</td>
                <td className="px-2 py-1.5">
                  <div className="font-medium">
                    {l.description}
                    {l.isCustomRate ? <span className="ml-1 text-[9.5px] font-normal text-slate-500">(custom rate)</span> : null}
                  </div>
                  {l.notes ? <div className="text-[10px] text-slate-500">{l.notes}</div> : null}
                </td>
                <td className="px-2 py-1.5">
                  <div className="font-medium tabular-nums">{l.quantity}</div>
                  <div className="text-[10px] text-slate-500">{l.quantityText}</div>
                </td>
                <td className="px-2 py-1.5">{l.unit}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{plain(l.listRatePaise)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{plain(l.grossPaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <section className="mt-3 flex justify-end">
          <table className="w-[88mm] text-[11.5px]">
            <tbody>
              <Row label="Subtotal (at list rates)" value={t.subtotalPaise} />
              {t.discountPaise > 0 ? <Row label={`Less: MCCIA member discount (${t.discountPct}%)`} value={-t.discountPaise} /> : null}
              <Row label="Taxable value" value={t.taxablePaise} bold />
              {t.intraState ? (
                <>
                  <Row label={`CGST @ ${half}%`} value={t.cgstPaise} />
                  <Row label={`SGST @ ${half}%`} value={t.sgstPaise} />
                </>
              ) : (
                <Row label={`IGST @ ${t.gstPct}%`} value={t.igstPaise} />
              )}
              {t.roundOffPaise !== 0 ? <Row label="Round off" value={t.roundOffPaise} /> : null}
              <tr className="border-t-2 border-[#0B1F3A]">
                <td className="py-1.5 text-[13px] font-semibold text-[#0B1F3A]">Grand total</td>
                <td className="py-1.5 text-right text-[13px] font-semibold text-[#0B1F3A] tabular-nums">{formatINR(t.grandTotalPaise)}</td>
              </tr>
            </tbody>
          </table>
        </section>
        <p className="mt-1 text-right text-[11px] italic">{t.amountInWords}</p>
        <p className="mt-1 text-[10px] text-slate-500">Price type: {view.priceTypeLabel}.</p>

        {view.notes ? (
          <section className="mt-4">
            <div className="text-[10px] font-semibold tracking-wider text-[#0B1F3A] uppercase">Notes</div>
            <p className="whitespace-pre-line">{view.notes}</p>
          </section>
        ) : null}

        <section className="mt-4">
          <div className="text-[10px] font-semibold tracking-wider text-[#0B1F3A] uppercase">Terms and conditions</div>
          <p className="whitespace-pre-line text-[10.5px] text-slate-700">{view.terms}</p>
        </section>

        <section className="mt-auto flex justify-end pt-10">
          <div className="text-center">
            <div className="text-[11px]">For {view.org.name}</div>
            <div className="mt-12 border-t border-slate-400 pt-1 text-[11px] font-semibold">Authorised Signatory</div>
          </div>
        </section>

        <footer className="mt-6 flex justify-between border-t border-slate-200 pt-2 text-[9.5px] text-slate-500">
          <span>This is a computer-generated quotation.</span>
          <span>Page 1</span>
        </footer>
      </article>
    </div>
  );
}

function plain(paise: number) {
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(paise / 100);
}

function Row({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  const neg = value < 0;
  return (
    <tr>
      <td className={bold ? "py-0.5 font-semibold" : "py-0.5 text-slate-700"}>{label}</td>
      <td className={`py-0.5 text-right tabular-nums ${bold ? "font-semibold" : ""}`}>
        {neg ? "- " : ""}
        {formatINR(Math.abs(value))}
      </td>
    </tr>
  );
}
