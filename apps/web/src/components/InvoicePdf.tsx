import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { CITY_NAME, monthLabel } from "@mm/core/city";
import { formatCents } from "@mm/core/fees";
import { count, dateTime, plainDate } from "@/lib/format";
import { verdict } from "@/lib/invoice";
import type { InvoiceDetail } from "@/server/fees";

const INK = "#1b1e22";
const MUTED = "#5b6168";
const RULE = "#c9c3b4";
const s = StyleSheet.create({
  page: { padding: 44, fontFamily: "Helvetica", fontSize: 10, color: INK, lineHeight: 1.4 },
  demo: { border: "1pt dashed #b4452a", color: "#b4452a", textAlign: "center", padding: 5, fontSize: 8, fontFamily: "Helvetica-Bold", letterSpacing: 1 },
  head: { flexDirection: "row", justifyContent: "space-between", marginTop: 18, paddingBottom: 12, borderBottom: `1.5pt solid ${INK}` },
  label: { fontSize: 7.5, color: MUTED, textTransform: "uppercase", letterSpacing: 1, fontFamily: "Helvetica-Bold" },
  title: { fontSize: 20, fontFamily: "Helvetica-Bold", marginTop: 3, marginBottom: 4, lineHeight: 1.2 },
  muted: { color: MUTED },
  row: { flexDirection: "row", borderBottom: `0.5pt solid ${RULE}`, paddingVertical: 6 },
  charge: { flex: 1, paddingRight: 8 },
  quantity: { width: 120, textAlign: "right" },
  amount: { width: 90, textAlign: "right", fontFamily: "Helvetica-Bold" },
  total: { flexDirection: "row", justifyContent: "flex-end", alignItems: "baseline", marginTop: 10 },
  section: { marginTop: 20 },
  line: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 1.5 },
  box: { marginTop: 8, padding: 10, border: `1pt solid ${INK}` },
  foot: { position: "absolute", left: 44, right: 44, bottom: 28, fontSize: 7.5, color: MUTED, textAlign: "center" },
});

export function InvoicePdf({ invoice }: { invoice: InvoiceDetail }) {
  const v = verdict(invoice);
  const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "-" : ""}${count(Math.abs(n))}`;
  return (
    <Document title={`Invoice ${invoice.number} (demonstration)`} author="Micromobility Monitor (demonstration)">
      <Page size="LETTER" style={s.page}>
        <Text style={s.demo}>DEMONSTRATION DOCUMENT · SIMULATED DATA · NOT A REAL BILL</Text>
        <View style={s.head}>
          <View>
            <Text style={s.label}>Shared mobility permit fees</Text>
            <Text style={s.title}>Invoice {invoice.number}</Text>
            <Text style={s.muted}>
              {CITY_NAME} (simulated) · billing period {monthLabel(invoice.year, invoice.month)}
            </Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={s.label}>Billed to</Text>
            <Text style={{ fontSize: 14, fontFamily: "Helvetica-Bold", marginTop: 3 }}>{invoice.operatorName}</Text>
            <Text style={s.muted}>a fictional operator</Text>
          </View>
        </View>

        <View style={[s.row, { marginTop: 12 }]}>
          <Text style={[s.charge, s.label]}>Charge</Text>
          <Text style={[s.quantity, s.label]}>Quantity</Text>
          <Text style={[s.amount, s.label]}>Amount</Text>
        </View>
        {invoice.lines.map((l) => (
          <View key={l.kind} style={s.row}>
            <Text style={[s.charge, l.kind.startsWith("exempt") ? s.muted : {}]}>{l.description}</Text>
            <Text style={s.quantity}>
              {count(l.quantity)} {l.unitLabel}
            </Text>
            <Text style={s.amount}>{l.kind.startsWith("exempt") ? "no charge" : formatCents(l.amountCents)}</Text>
          </View>
        ))}
        <View style={s.total}>
          <Text style={[s.label, { marginRight: 14 }]}>Amount due</Text>
          <Text style={{ fontSize: 18, fontFamily: "Helvetica-Bold" }}>{formatCents(invoice.totalCents)}</Text>
        </View>

        <View style={[s.section, { flexDirection: "row", gap: 24 }]}>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>How the device fee was prorated</Text>
            {invoice.permits.map((p) => (
              <Text key={`${p.startDate}-${p.devices}`} style={{ marginTop: 4 }}>
                {count(p.devices)} devices from {plainDate(p.startDate)}
                {p.endDate ? ` to ${plainDate(p.endDate)}` : ""}
                {p.note ? ` (${p.note})` : ""}
              </Text>
            ))}
            <Text style={[s.muted, { marginTop: 4 }]}>
              {count(invoice.deviceDays)} device-days in the month, at {formatCents(invoice.schedule.perDeviceAnnualCents)} per device per year.
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.label, { marginBottom: 4 }]}>How the rides were counted</Text>
            <View style={s.line}>
              <Text>Trip records received and valid</Text>
              <Text>{count(invoice.observedTrips)}</Text>
            </View>
            <View style={s.line}>
              <Text>Less: equity-zone rides (exempt)</Text>
              <Text>-{count(invoice.exemptEquityTrips)}</Text>
            </View>
            <View style={s.line}>
              <Text>Less: rides under {invoice.schedule.minBillableTripSeconds} seconds (exempt)</Text>
              <Text>-{count(invoice.exemptShortTrips)}</Text>
            </View>
            <View style={[s.line, { borderTop: `0.5pt solid ${RULE}`, marginTop: 2, paddingTop: 3 }]}>
              <Text style={{ fontFamily: "Helvetica-Bold" }}>Billable rides at {formatCents(invoice.schedule.perRideCents)}</Text>
              <Text style={{ fontFamily: "Helvetica-Bold" }}>{count(invoice.billableTrips)}</Text>
            </View>
          </View>
        </View>

        <View style={s.section}>
          <Text style={s.label}>Reconciliation with the operator&apos;s monthly report: {v.label}</Text>
          <View style={s.box}>
            <View style={s.line}>
              <Text>Rides counted by the city, from trip records</Text>
              <Text>{count(invoice.observedTrips)}</Text>
            </View>
            <View style={s.line}>
              <Text>Rides reported by the operator</Text>
              <Text>{invoice.reportedTrips === null ? "not filed" : count(invoice.reportedTrips)}</Text>
            </View>
            {invoice.deltaTrips !== null && (
              <>
                <View style={s.line}>
                  <Text>Difference (city minus operator)</Text>
                  <Text>
                    {signed(invoice.deltaTrips)} ({(invoice.deltaPct ?? 0).toFixed(2)}%)
                  </Text>
                </View>
                <View style={s.line}>
                  <Text>Fee at risk had the operator&apos;s count been billed</Text>
                  <Text>{formatCents(invoice.feeAtRiskCents ?? 0)}</Text>
                </View>
              </>
            )}
            <View style={s.line}>
              <Text>Trip records rejected for failing the schema</Text>
              <Text>{count(invoice.rejectedTripRecords)}</Text>
            </View>
            <Text style={{ marginTop: 8, fontFamily: "Helvetica-Bold" }}>{v.headline}</Text>
            <Text style={[s.muted, { marginTop: 2 }]}>{v.explanation}</Text>
          </View>
        </View>

        <Text style={s.foot} fixed>
          Calculated {dateTime(invoice.generatedAt)} Mountain Time. Demonstration build: simulated data from fictional operators, not used by or affiliated with any city.
        </Text>
      </Page>
    </Document>
  );
}
