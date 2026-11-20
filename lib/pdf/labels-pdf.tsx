import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { formatDate } from "@/lib/format";
import { registerFonts } from "./quotation-pdf";

/** A4 sheet of 24 labels (3 across, 8 down; 70 x 37 mm, a common label-sheet size). */
export const LABELS_PER_SHEET = 24;
const MM = 72 / 25.4;
const W = 70 * MM;
const H = 37 * MM;
const TOP = (297 - 37 * 8) / 2;

const s = StyleSheet.create({
  page: { fontFamily: "Outfit", flexDirection: "row", flexWrap: "wrap", paddingTop: TOP * MM, paddingBottom: 0, paddingHorizontal: 0 },
  label: { width: W, height: H, flexDirection: "row", alignItems: "center", paddingHorizontal: 3.5 * MM, paddingVertical: 2.5 * MM, gap: 2.5 * MM },
  qr: { width: 29 * MM, height: 29 * MM },
  name: { fontSize: 9, fontWeight: 600, color: "#0B1F3A", lineHeight: 1.2, maxLines: 3 },
  line: { fontSize: 7.5, color: "#334155", marginTop: 1.5 },
  small: { fontSize: 6.5, color: "#64748B", marginTop: 2 },
});

export interface LabelData {
  name: string;
  code: string;
  unit: string;
  batchNo?: string | null;
  expiryDate?: string | null;
  qrDataUrl: string;
  /** Cut lines help when printing on plain paper. */
  outline: boolean;
}

export function LabelsPdf({ label, count }: { label: LabelData; count: number }) {
  registerFonts();
  return (
    <Document title={`Labels ${label.code}`}>
      <Page size="A4" style={s.page}>
        {Array.from({ length: count }, (_, n) => (
          <View key={n} style={[s.label, label.outline ? { borderWidth: 0.4, borderColor: "#CBD5E1", borderStyle: "dashed" } : {}]} wrap={false}>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
            <Image src={label.qrDataUrl} style={s.qr} />
            <View style={{ flex: 1 }}>
              <Text style={s.name}>{label.name}</Text>
              <Text style={s.line}>
                {label.code} · {label.unit}
              </Text>
              {label.batchNo ? <Text style={s.line}>Batch {label.batchNo}</Text> : null}
              {label.expiryDate ? <Text style={[s.line, { fontWeight: 600 }]}>Expires {formatDate(label.expiryDate)}</Text> : null}
              <Text style={s.small}>Scan to use stock</Text>
            </View>
          </View>
        ))}
      </Page>
    </Document>
  );
}
