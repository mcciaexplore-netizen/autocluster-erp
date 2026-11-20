import { Document, Font, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { formatDate } from "@/lib/format";
import { formatINR } from "@/lib/pricing";
import type { QuoteView } from "@/lib/quote-view";
import { dmSerif400, outfit400, outfit500, outfit600, rupee400, rupee600 } from "./fonts.generated";

let registered = false;
export function registerFonts() {
  if (registered) return;
  Font.register({
    family: "Outfit",
    fonts: [
      { src: outfit400, fontWeight: 400 },
      { src: outfit500, fontWeight: 500 },
      { src: outfit600, fontWeight: 600 },
    ],
  });
  Font.register({ family: "DM Serif Display", src: dmSerif400 });
  // Outfit has no ₹ sign, so the symbol is drawn with Noto Sans.
  Font.register({
    family: "Rupee",
    fonts: [
      { src: rupee400, fontWeight: 400 },
      { src: rupee600, fontWeight: 600 },
    ],
  });
  Font.registerHyphenationCallback((word) => [word]);
  registered = true;
}

const NAVY = "#0B1F3A";
const MUTED = "#64748B";
const LINE = "#E2E8F0";

const s = StyleSheet.create({
  page: { fontFamily: "Outfit", fontSize: 9, color: "#0F172A", paddingTop: 36, paddingBottom: 54, paddingHorizontal: 40, lineHeight: 1.35 },
  header: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 2, borderBottomColor: NAVY, paddingBottom: 10 },
  logo: { width: 40, height: 40, borderRadius: 6, backgroundColor: NAVY, color: "#fff", fontFamily: "DM Serif Display", fontSize: 16, textAlign: "center", paddingTop: 10 },
  orgName: { fontSize: 12, fontWeight: 600, color: NAVY },
  small: { fontSize: 8, color: MUTED },
  title: { fontFamily: "DM Serif Display", fontSize: 24, color: NAVY, textAlign: "right", letterSpacing: 1, lineHeight: 1.1, marginBottom: 4 },
  label: { fontSize: 7.5, fontWeight: 600, color: NAVY, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 2 },
  th: { color: "#fff", fontWeight: 500, fontSize: 8, paddingVertical: 4, paddingHorizontal: 4 },
  td: { paddingVertical: 4, paddingHorizontal: 4, fontSize: 8.5 },
  row: { flexDirection: "row", borderBottomWidth: 0.6, borderBottomColor: LINE },
  footerLine: { position: "absolute", bottom: 38, left: 40, right: 40, borderTopWidth: 0.6, borderTopColor: LINE },
  footerLeft: { position: "absolute", bottom: 24, left: 40, fontSize: 7.5, color: MUTED },
});

const COLS = { sr: "5%", dept: "7%", desc: "34%", qty: "20%", unit: "8%", rate: "12%", amount: "14%" };

/** Amount with the ₹ sign drawn in a font that has it. */
export function Money({ paise, bold }: { paise: number; bold?: boolean }) {
  const neg = paise < 0;
  const text = formatINR(Math.abs(paise)).replace("₹", "");
  return (
    <Text style={bold ? { fontWeight: 600 } : undefined}>
      {neg ? "- " : ""}
      <Text style={{ fontFamily: "Rupee", fontWeight: bold ? 600 : 400 }}>₹</Text>
      {text}
    </Text>
  );
}

function plain(paise: number) {
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(paise / 100);
}

function TotalRow({ label, paise, bold }: { label: string; paise: number; bold?: boolean }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 1.5 }}>
      <Text style={bold ? { fontWeight: 600 } : { color: "#334155" }}>{label}</Text>
      <Money paise={paise} bold={bold} />
    </View>
  );
}

export function QuotationPdf({ view }: { view: QuoteView }) {
  registerFonts();
  const t = view.totals;
  const c = view.customer;
  const half = t.gstPct / 2;
  return (
    <Document title={`Quotation ${view.quoteNo}`} author={view.org.name} subject={view.subject} creator={view.org.name}>
      <Page size="A4" style={s.page}>
        {/* Header */}
        <View style={s.header}>
          <View style={{ flexDirection: "row", gap: 8, width: "62%" }}>
            <Text style={s.logo}>AC</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.orgName}>{view.org.name}</Text>
              <Text style={s.small}>{view.org.address}</Text>
              <Text style={s.small}>
                GSTIN {view.org.gstin} · {view.org.phone} · {view.org.email}
              </Text>
            </View>
          </View>
          <View style={{ width: "36%" }}>
            <Text style={s.title}>QUOTATION</Text>
            {[
              ["Quotation no.", view.quoteNo],
              ["Date", formatDate(view.quoteDate)],
              ["Valid until", formatDate(view.validUntil)],
            ].map(([k, v]) => (
              <View key={k} style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: 2 }}>
                <Text style={{ color: MUTED, marginRight: 6 }}>{k}</Text>
                <Text style={{ fontWeight: k === "Quotation no." ? 600 : 400 }}>{v}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* To */}
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 12 }}>
          <View style={{ width: "55%" }}>
            <Text style={s.label}>To</Text>
            <Text style={{ fontSize: 10.5, fontWeight: 600 }}>{c.companyName}</Text>
            <Text>{[c.addressLine1, c.addressLine2].filter(Boolean).join(", ")}</Text>
            <Text>
              {c.city} - {c.pincode}, {c.state}
            </Text>
            <Text style={{ marginTop: 2 }}>
              {c.gstRegistered ? `GSTIN ${c.gstin}` : "Not registered under GST"} · PAN {c.pan}
            </Text>
          </View>
          <View style={{ width: "42%", alignItems: "flex-end" }}>
            <Text style={s.label}>Kind attention</Text>
            <Text style={{ fontWeight: 600 }}>{c.pocName}</Text>
            {c.pocDesignation ? <Text>{c.pocDesignation}</Text> : null}
            <Text>+91 {c.pocPhone}</Text>
            <Text>{c.pocEmail}</Text>
            {c.isMcciaMember && c.mcciaMembershipId ? <Text>MCCIA Membership ID: {c.mcciaMembershipId}</Text> : null}
          </View>
        </View>

        <Text style={{ marginTop: 12 }}>
          <Text style={{ fontWeight: 600 }}>Subject: </Text>
          {view.subject}
        </Text>

        {/* Table */}
        <View style={{ marginTop: 8 }}>
          <View style={{ flexDirection: "row", backgroundColor: NAVY }} fixed>
            <Text style={[s.th, { width: COLS.sr }]}>Sr.</Text>
            <Text style={[s.th, { width: COLS.dept }]}>Dept.</Text>
            <Text style={[s.th, { width: COLS.desc }]}>Service / description</Text>
            <Text style={[s.th, { width: COLS.qty }]}>Quantity</Text>
            <Text style={[s.th, { width: COLS.unit }]}>Unit</Text>
            <View style={{ width: COLS.rate, flexDirection: "row", justifyContent: "flex-end", paddingVertical: 4, paddingHorizontal: 4 }}>
              <Text style={{ color: "#fff", fontWeight: 500, fontSize: 8 }}>
                Rate (<Text style={{ fontFamily: "Rupee" }}>₹</Text>)
              </Text>
            </View>
            <View style={{ width: COLS.amount, flexDirection: "row", justifyContent: "flex-end", paddingVertical: 4, paddingHorizontal: 4 }}>
              <Text style={{ color: "#fff", fontWeight: 500, fontSize: 8 }}>
                Amount (<Text style={{ fontFamily: "Rupee" }}>₹</Text>)
              </Text>
            </View>
          </View>
          {view.lines.map((l) => (
            <View key={l.srNo} style={s.row} wrap={false}>
              <Text style={[s.td, { width: COLS.sr }]}>{l.srNo}</Text>
              <Text style={[s.td, { width: COLS.dept }]}>{l.deptCode ?? "-"}</Text>
              <View style={[s.td, { width: COLS.desc }]}>
                <Text style={{ fontWeight: 500 }}>
                  {l.description}
                  {l.isCustomRate ? <Text style={{ fontWeight: 400, color: MUTED, fontSize: 7.5 }}> (custom rate)</Text> : null}
                </Text>
                {l.notes ? <Text style={{ fontSize: 7.5, color: MUTED }}>{l.notes}</Text> : null}
              </View>
              <View style={[s.td, { width: COLS.qty }]}>
                <Text style={{ fontWeight: 500 }}>{l.quantity}</Text>
                <Text style={{ fontSize: 7.5, color: MUTED }}>{l.quantityText}</Text>
              </View>
              <Text style={[s.td, { width: COLS.unit }]}>{l.unit}</Text>
              <Text style={[s.td, { width: COLS.rate, textAlign: "right" }]}>{plain(l.listRatePaise)}</Text>
              <Text style={[s.td, { width: COLS.amount, textAlign: "right" }]}>{plain(l.grossPaise)}</Text>
            </View>
          ))}
        </View>

        {/* Totals */}
        <View style={{ alignItems: "flex-end", marginTop: 8 }} wrap={false}>
          <View style={{ width: 230 }}>
            <TotalRow label="Subtotal (at list rates)" paise={t.subtotalPaise} />
            {t.discountPaise > 0 ? <TotalRow label={`Less: MCCIA member discount (${t.discountPct}%)`} paise={-t.discountPaise} /> : null}
            <TotalRow label="Taxable value" paise={t.taxablePaise} bold />
            {t.intraState ? (
              <>
                <TotalRow label={`CGST @ ${half}%`} paise={t.cgstPaise} />
                <TotalRow label={`SGST @ ${half}%`} paise={t.sgstPaise} />
              </>
            ) : (
              <TotalRow label={`IGST @ ${t.gstPct}%`} paise={t.igstPaise} />
            )}
            {t.roundOffPaise !== 0 ? <TotalRow label="Round off" paise={t.roundOffPaise} /> : null}
            <View
              style={{ flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1.5, borderTopColor: NAVY, marginTop: 3, paddingTop: 4 }}
            >
              <Text style={{ fontSize: 11, fontWeight: 600, color: NAVY }}>Grand total</Text>
              <Text style={{ fontSize: 11, color: NAVY }}>
                <Money paise={t.grandTotalPaise} bold />
              </Text>
            </View>
          </View>
          <Text style={{ marginTop: 3, fontSize: 8.5 }}>{t.amountInWords}</Text>
          <Text style={{ marginTop: 2, fontSize: 7.5, color: MUTED }}>Price type: {view.priceTypeLabel}.</Text>
        </View>

        {view.notes ? (
          <View style={{ marginTop: 12 }} wrap={false}>
            <Text style={s.label}>Notes</Text>
            <Text>{view.notes}</Text>
          </View>
        ) : null}

        <View style={{ marginTop: 12 }}>
          <Text style={s.label}>Terms and conditions</Text>
          <Text style={{ fontSize: 8, color: "#334155" }}>{view.terms}</Text>
        </View>

        <View style={{ marginTop: 28, alignItems: "flex-end" }} wrap={false}>
          <Text>For {view.org.name}</Text>
          <Text style={{ marginTop: 32, borderTopWidth: 0.8, borderTopColor: "#94A3B8", paddingTop: 3, fontWeight: 600 }}>Authorised Signatory</Text>
        </View>

        <View style={s.footerLine} fixed />
        <Text style={s.footerLeft} fixed>
          This is a computer-generated quotation.
        </Text>
      </Page>
    </Document>
  );
}
