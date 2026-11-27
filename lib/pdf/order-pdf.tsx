import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { orgInitials } from "@/lib/org";
import { formatDate } from "@/lib/format";
import type { OrderListData } from "@/lib/inventory-data";
import { formatRate } from "@/lib/inventory/numbers";
import { orderQtyText } from "@/lib/inventory/reorder";
import { registerFonts } from "./quotation-pdf";

const NAVY = "#0B1F3A";
const MUTED = "#64748B";
const LINE = "#E2E8F0";

const s = StyleSheet.create({
  page: { fontFamily: "Outfit", fontSize: 9, color: "#0F172A", paddingTop: 36, paddingBottom: 54, paddingHorizontal: 40, lineHeight: 1.35 },
  header: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 2, borderBottomColor: NAVY, paddingBottom: 10 },
  logo: { width: 40, height: 40, borderRadius: 6, backgroundColor: NAVY, color: "#fff", fontFamily: "DM Serif Display", fontSize: 16, textAlign: "center", paddingTop: 10 },
  orgName: { fontSize: 12, fontWeight: 600, color: NAVY },
  small: { fontSize: 8, color: MUTED },
  title: { fontFamily: "DM Serif Display", fontSize: 22, color: NAVY, textAlign: "right", letterSpacing: 1, lineHeight: 1.1, marginBottom: 4 },
  label: { fontSize: 7.5, fontWeight: 600, color: NAVY, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 2 },
  th: { color: "#fff", fontWeight: 500, fontSize: 8, paddingVertical: 4, paddingHorizontal: 4 },
  td: { paddingVertical: 5, paddingHorizontal: 4, fontSize: 9 },
  row: { flexDirection: "row", borderBottomWidth: 0.6, borderBottomColor: LINE },
});
const COLS = { sr: "7%", item: "45%", qty: "30%", rate: "18%" };

/** The order list sent to a supplier: items and quantities, with the organisation's details. */
export function OrderListPdf({ data }: { data: OrderListData }) {
  registerFonts();
  const { org, supplier, items, today } = data;
  return (
    <Document title={`Order list ${formatDate(today)}`} author={org.name} creator={org.name}>
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View style={{ flexDirection: "row", gap: 8, width: "62%" }}>
            <Text style={s.logo}>{orgInitials(org.name)}</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.orgName}>{org.name}</Text>
              <Text style={s.small}>{org.address}</Text>
              <Text style={s.small}>
                GSTIN {org.gstin} · {org.phone} · {org.email}
              </Text>
            </View>
          </View>
          <View style={{ width: "36%" }}>
            <Text style={s.title}>ORDER LIST</Text>
            <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: 2 }}>
              <Text style={{ color: MUTED, marginRight: 6 }}>Date</Text>
              <Text>{formatDate(today)}</Text>
            </View>
          </View>
        </View>

        {supplier ? (
          <View style={{ marginTop: 12 }}>
            <Text style={s.label}>To</Text>
            <Text style={{ fontSize: 10.5, fontWeight: 600 }}>{supplier.name}</Text>
            {supplier.contactName ? <Text>Kind attention: {supplier.contactName}</Text> : null}
            {supplier.address ? <Text>{supplier.address}</Text> : null}
            <Text>{[supplier.phone, supplier.email, supplier.gstin ? `GSTIN ${supplier.gstin}` : null].filter(Boolean).join(" · ")}</Text>
          </View>
        ) : null}

        <Text style={{ marginTop: 12 }}>Please supply the following items. Kindly confirm the rates and the delivery date.</Text>

        <View style={{ marginTop: 8 }}>
          <View style={{ flexDirection: "row", backgroundColor: NAVY }} fixed>
            <Text style={[s.th, { width: COLS.sr }]}>Sr.</Text>
            <Text style={[s.th, { width: COLS.item }]}>Item</Text>
            <Text style={[s.th, { width: COLS.qty }]}>Quantity</Text>
            <Text style={[s.th, { width: COLS.rate, textAlign: "right" }]}>Last rate, before GST</Text>
          </View>
          {items.map((it, i) => (
            <View key={it.id} style={s.row} wrap={false}>
              <Text style={[s.td, { width: COLS.sr }]}>{i + 1}</Text>
              <View style={[s.td, { width: COLS.item }]}>
                <Text style={{ fontWeight: 500 }}>{it.name}</Text>
                <Text style={s.small}>Our code {it.code}</Text>
              </View>
              <Text style={[s.td, { width: COLS.qty }]}>{orderQtyText({ name: it.name, qty: it.qty, unit: it.unit, packName: it.pack_name, packSize: it.pack_size })}</Text>
              <View style={[s.td, { width: COLS.rate, flexDirection: "row", justifyContent: "flex-end" }]}>
                {it.rate ? (
                  <Text>
                    <Text style={{ fontFamily: "Rupee" }}>₹</Text>
                    {formatRate(it.rate).replace("₹", "")} per {it.unit}
                  </Text>
                ) : (
                  <Text style={{ color: MUTED }}>-</Text>
                )}
              </View>
            </View>
          ))}
        </View>

        <Text style={{ marginTop: 14, color: MUTED }}>Last rates are for reference only. Please mention the order date on your bill.</Text>
        <Text style={{ marginTop: 24 }}>For {org.name}</Text>
        <Text style={{ marginTop: 2, color: MUTED }}>Stores</Text>
      </Page>
    </Document>
  );
}
