import { Document, Page, Rect, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";
import { CITY_NAME } from "@mm/core/city";
import { formatCents } from "@mm/core/fees";
import { count, dateTime, percent, plainDay } from "@/lib/format";
import { operatorHex } from "@/lib/meaning";
import { hourSpan, km, minutes, rate, share, typeLine } from "@/lib/report";
import type { Bucket, MonthlyReport } from "@/server/reports";

const INK = "#1b1e22";
const MUTED = "#5b6168";
const RULE = "#c9c3b4";
const BAR = "#7d8791";
// Print colours for the operators: the screen colours are tuned for a dark map.
const PRINT: Record<string, string> = { kestrel: "#3567cf", pronghorn: "#c8388f", saltgrass: "#84801c" };
const ink = (slug: string) => PRINT[slug] ?? operatorHex(slug);

const s = StyleSheet.create({
  page: { paddingTop: 40, paddingHorizontal: 44, paddingBottom: 56, fontFamily: "Helvetica", fontSize: 9.5, color: INK, lineHeight: 1.4 },
  demo: { border: "1pt dashed #b4452a", color: "#b4452a", textAlign: "center", padding: 5, fontSize: 8, fontFamily: "Helvetica-Bold", letterSpacing: 1 },
  head: { marginTop: 16, paddingBottom: 10, borderBottom: `1.5pt solid ${INK}` },
  label: { fontSize: 7.5, color: MUTED, textTransform: "uppercase", letterSpacing: 1, fontFamily: "Helvetica-Bold" },
  title: { fontSize: 20, fontFamily: "Helvetica-Bold", marginTop: 3, marginBottom: 4, lineHeight: 1.2 },
  muted: { color: MUTED },
  bold: { fontFamily: "Helvetica-Bold" },
  section: { marginTop: 18 },
  h: { fontSize: 11, fontFamily: "Helvetica-Bold", paddingBottom: 4, borderBottom: `0.75pt solid ${INK}` },
  row: { flexDirection: "row", borderBottom: `0.5pt solid ${RULE}`, paddingVertical: 4.5 },
  first: { flex: 1, paddingRight: 6 },
  cell: { width: 62, textAlign: "right" },
  figures: { flexDirection: "row", marginTop: 12 },
  figure: { flex: 1, paddingRight: 10 },
  big: { fontSize: 17, fontFamily: "Helvetica-Bold", marginTop: 2, lineHeight: 1.2 },
  small: { fontSize: 8, color: MUTED },
  foot: { position: "absolute", left: 44, right: 44, bottom: 26, fontSize: 7.5, color: MUTED, textAlign: "center" },
});

const WIDTH = 524;

function DailyChart({ report }: { report: MonthlyReport }) {
  const height = 96;
  const max = Math.max(1, ...report.daily.map((d) => d.total));
  const step = WIDTH / report.daily.length;
  const order = [...report.operators].reverse();
  return (
    <Svg width={WIDTH} height={height + 1}>
      {report.daily.flatMap((d, i) => {
        let top = height;
        // Biggest fleet first, drawn up from the baseline.
        return [...order].reverse().map((o) => {
          const h = ((d.byOperator[o.slug] ?? 0) / max) * height;
          top -= h;
          return <Rect key={`${d.date}-${o.slug}`} x={i * step + 1} y={top} width={step - 2} height={h} fill={ink(o.slug)} />;
        });
      })}
      <Rect x={0} y={height} width={WIDTH} height={0.75} fill={INK} />
    </Svg>
  );
}

function HourChart({ report, of }: { report: MonthlyReport; of: "weekday" | "weekend" }) {
  const width = WIDTH / 2 - 12;
  const height = 48;
  const max = Math.max(1, ...report.hours.map((h) => Math.max(h.weekday, h.weekend)));
  const step = width / 24;
  return (
    <Svg width={width} height={height + 1}>
      {report.hours.map((h) => (
        <Rect key={h.hour} x={h.hour * step + 0.75} y={height - (h[of] / max) * height} width={step - 1.5} height={(h[of] / max) * height} fill={BAR} />
      ))}
      <Rect x={0} y={height} width={width} height={0.75} fill={INK} />
    </Svg>
  );
}

function Spread({ title, typical, buckets }: { title: string; typical: string; buckets: Bucket[] }) {
  const total = buckets.reduce((sum, b) => sum + b.trips, 0);
  return (
    <View style={{ flex: 1 }}>
      <Text style={s.h}>{title}</Text>
      {buckets.map((b) => (
        <View key={b.label} style={s.row}>
          <Text style={s.first}>{b.label}</Text>
          <Text style={[s.cell, s.muted]}>{count(b.trips)}</Text>
          <Text style={[s.cell, s.bold, { width: 48 }]}>{share(b.trips, total)}</Text>
        </View>
      ))}
      <Text style={[s.small, { marginTop: 4 }]}>Typical ride (median): {typical}</Text>
    </View>
  );
}

/** The monthly report on paper. It carries the same sections the reader's seat sees on screen. */
export function MonthlyReportPdf({ report, reader }: { report: MonthlyReport; reader: { name: string; roleLabel: string } }) {
  const c = report.compliance;
  const r = report.revenue;
  const weeks = c?.weeks.length ?? 0;
  const figures: [string, string, string][] = [
    ["Rides", count(report.city.trips), `${count(Math.round(report.city.trips / report.days))} a day on average`],
    ["Per vehicle per day", rate(report.city.perVehicleDay), `${count(report.city.vehicles)} vehicles on the rosters`],
  ];
  if (c) figures.push(["Rules kept", percent(c.rate, 0), `${count(c.ruleWeeks - c.breached)} of ${count(c.ruleWeeks)} weekly checks`]);
  if (r && r.rows.length > 0) figures.push(["Permit fees", formatCents(r.totalCents), `${formatCents(r.issuedCents)} issued`]);

  return (
    <Document title={`Shared mobility monthly report, ${report.label} (demonstration)`} author="Micromobility Monitor (demonstration)">
      <Page size="LETTER" style={s.page}>
        <Text style={s.demo}>DEMONSTRATION DOCUMENT · SIMULATED DATA · FICTIONAL OPERATORS</Text>
        <View style={s.head}>
          <Text style={s.label}>Shared mobility monthly report</Text>
          <Text style={s.title}>{report.label}</Text>
          <Text style={s.muted}>
            {CITY_NAME} (simulated) · prepared for {reader.name}, {reader.roleLabel.toLowerCase()}
          </Text>
        </View>

        <View style={s.figures}>
          {figures.map(([label, value, note]) => (
            <View key={label} style={s.figure}>
              <Text style={s.label}>{label}</Text>
              <Text style={s.big}>{value}</Text>
              <Text style={s.small}>{note}</Text>
            </View>
          ))}
        </View>

        <View style={s.section}>
          <Text style={s.h}>Rides per day</Text>
          <View style={{ marginTop: 8 }}>
            <DailyChart report={report} />
          </View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 3 }}>
            <Text style={s.small}>{plainDay(report.daily[0]!.date)}</Text>
            <Text style={s.small}>{plainDay(report.daily.at(-1)!.date)}</Text>
          </View>
          <View style={{ flexDirection: "row", marginTop: 4, gap: 14 }}>
            {report.operators.map((o) => (
              <View key={o.slug} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <View style={{ width: 7, height: 7, backgroundColor: ink(o.slug) }} />
                <Text style={s.small}>{o.name}</Text>
              </View>
            ))}
          </View>
          {report.busiest && report.quietest && (
            <Text style={{ marginTop: 6 }}>
              Busiest day {plainDay(report.busiest.date)} with {count(report.busiest.total)} rides; quietest {plainDay(report.quietest.date)} with {count(report.quietest.total)}.
            </Text>
          )}
        </View>

        <View style={s.section} wrap={false}>
          <Text style={s.h}>By operator</Text>
          <View style={s.row}>
            <Text style={[s.first, s.small]}>Operator</Text>
            {["Rides", "Share", "Vehicles", "Per vehicle per day", "Typical distance", "Typical time"].map((t) => (
              <Text key={t} style={[s.cell, s.small]}>
                {t}
              </Text>
            ))}
          </View>
          {[...report.operators.map((o) => ({ ...o, strong: true })), ...report.types.map((t) => ({ ...t, name: typeLine(t.type), strong: false }))].map((o) => (
            <View key={o.name} style={s.row}>
              <Text style={[s.first, o.strong ? s.bold : s.muted]}>{o.name}</Text>
              <Text style={s.cell}>{count(o.trips)}</Text>
              <Text style={s.cell}>{percent(o.trips / report.city.trips)}</Text>
              <Text style={s.cell}>{count(o.vehicles)}</Text>
              <Text style={[s.cell, o.strong ? s.bold : {}]}>{rate(o.perVehicleDay)}</Text>
              <Text style={s.cell}>{km(o.medianDistanceM)}</Text>
              <Text style={s.cell}>{minutes(o.medianDurationS)}</Text>
            </View>
          ))}
          <Text style={[s.small, { marginTop: 4 }]}>Rides per vehicle per day counts every vehicle on the operator&apos;s roster during the month. Typical figures are medians.</Text>
        </View>

        {report.peak && (
          <View style={s.section} wrap={false}>
            <Text style={s.h}>Peak hours</Text>
            <View style={{ flexDirection: "row", gap: 24, marginTop: 8 }}>
              {(["weekday", "weekend"] as const).map((key) => (
                <View key={key} style={{ flex: 1 }}>
                  <Text>
                    <Text style={s.bold}>{key === "weekday" ? "Weekdays" : "Weekends"}</Text>: busiest {hourSpan(report.peak![key].hour)}, about {count(Math.round(report.peak![key][key]))} rides
                  </Text>
                  <View style={{ marginTop: 5 }}>
                    <HourChart report={report} of={key} />
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 2 }}>
                    <Text style={s.small}>midnight</Text>
                    <Text style={s.small}>noon</Text>
                    <Text style={s.small}>midnight</Text>
                  </View>
                </View>
              ))}
            </View>
            <Text style={[s.small, { marginTop: 4 }]}>Rides started in each hour on an average day, both drawn to the same scale.</Text>
          </View>
        )}

        <View style={[s.section, { flexDirection: "row", gap: 24 }]} wrap={false}>
          <Spread title="Ride distance" typical={km(report.city.medianDistanceM)} buckets={report.distance} />
          <Spread title="Ride time" typical={minutes(report.city.medianDurationS)} buckets={report.duration} />
        </View>

        <View style={s.section} wrap={false}>
          <Text style={s.h}>Equity zones</Text>
          <Text style={{ marginTop: 6 }}>
            {percent(report.city.equityTrips / report.city.trips, 0)} of rides started, ended or passed through an equity zone ({report.operators.map((o) => `${o.name} ${o.trips > 0 ? percent(o.equityTrips / o.trips, 0) : "no data"}`).join(", ")}).
          </Text>
          <View style={[s.row, { marginTop: 4 }]}>
            <Text style={[s.first, s.small]}>Zone</Text>
            <Text style={[s.cell, s.small, { width: 110 }]}>Rides started there</Text>
            <Text style={[s.cell, s.small, { width: 110 }]}>Rides ended there</Text>
          </View>
          {report.equityZones.map((z) => (
            <View key={z.name} style={s.row}>
              <Text style={s.first}>{z.name}</Text>
              <Text style={[s.cell, { width: 110 }]}>{count(z.starts)}</Text>
              <Text style={[s.cell, { width: 110 }]}>{count(z.ends)}</Text>
            </View>
          ))}
        </View>

        {c && (
          <View style={s.section} wrap={false}>
            <Text style={s.h}>Rules kept</Text>
            <View style={s.row}>
              <Text style={[s.first, s.small]}>Weeks without a confirmed breach, of {weeks}</Text>
              {c.rules.map((rule) => (
                <Text key={rule.kind} style={[s.cell, s.small, { width: 58 }]}>
                  {rule.label}
                </Text>
              ))}
              <Text style={[s.cell, s.small, { width: 44 }]}>All rules</Text>
              <Text style={[s.cell, s.small, { width: 44 }]}>Notices</Text>
            </View>
            {c.operators.map((o) => (
              <View key={o.slug} style={s.row}>
                <Text style={[s.first, s.bold]}>{o.name}</Text>
                {c.rules.map((rule) => {
                  const clear = weeks - (o.byRule[rule.kind] ?? 0);
                  return (
                    <Text key={rule.kind} style={[s.cell, { width: 58 }, clear === weeks ? {} : s.bold]}>
                      {clear} of {weeks}
                    </Text>
                  );
                })}
                <Text style={[s.cell, s.bold, { width: 44 }]}>{percent(o.rate, 0)}</Text>
                <Text style={[s.cell, { width: 44 }]}>{count(o.notices)}</Text>
              </View>
            ))}
            <Text style={[s.small, { marginTop: 4 }]}>
              A week counts against an operator once an analyst has checked and counted at least one finding in it. Findings held for doubtful data, set aside, or in a withdrawn case do not count.
            </Text>
          </View>
        )}

        {r && r.rows.length > 0 && (
          <View style={s.section} wrap={false}>
            <Text style={s.h}>Permit fees</Text>
            <View style={s.row}>
              <Text style={[s.first, s.small]}>Operator and invoice</Text>
              {["Device fees", "Ride fees", "Billable rides", "Waived, equity", "Total"].map((t) => (
                <Text key={t} style={[s.cell, s.small, { width: 68 }]}>
                  {t}
                </Text>
              ))}
            </View>
            {r.rows.map((i) => (
              <View key={i.number} style={s.row}>
                <View style={s.first}>
                  <Text style={s.bold}>{i.name}</Text>
                  <Text style={s.small}>
                    {i.number} · {i.status}
                  </Text>
                </View>
                <Text style={[s.cell, { width: 68 }]}>{formatCents(i.deviceCents)}</Text>
                <Text style={[s.cell, { width: 68 }]}>{formatCents(i.rideCents)}</Text>
                <Text style={[s.cell, { width: 68 }]}>{count(i.billableTrips)}</Text>
                <Text style={[s.cell, { width: 68 }]}>{formatCents(i.waivedCents)}</Text>
                <Text style={[s.cell, s.bold, { width: 68 }]}>{formatCents(i.totalCents)}</Text>
              </View>
            ))}
            <View style={s.row}>
              <Text style={[s.first, s.bold]}>All operators</Text>
              <Text style={[s.cell, { width: 68 }]}>{formatCents(r.rows.reduce((sum, i) => sum + i.deviceCents, 0))}</Text>
              <Text style={[s.cell, { width: 68 }]}>{formatCents(r.rows.reduce((sum, i) => sum + i.rideCents, 0))}</Text>
              <Text style={[s.cell, { width: 68 }]}>{count(r.rows.reduce((sum, i) => sum + i.billableTrips, 0))}</Text>
              <Text style={[s.cell, { width: 68 }]}>{formatCents(r.waivedCents)}</Text>
              <Text style={[s.cell, s.bold, { width: 68 }]}>{formatCents(r.totalCents)}</Text>
            </View>
            <Text style={[s.small, { marginTop: 4 }]}>
              {formatCents(r.issuedCents)} issued, {formatCents(r.totalCents - r.issuedCents)} still in draft when this was drawn. Waived is the ride fee given up on rides that touched an equity zone.
            </Text>
          </View>
        )}

        {(!c || !r) && (
          <Text style={[s.small, { marginTop: 14 }]}>
            Left out for this reader&apos;s seat: {[!c && "how the operators kept to the rules", !r && "permit fees"].filter(Boolean).join(" and ")}.
          </Text>
        )}

        <Text style={s.foot} fixed>
          Drawn from the records {dateTime(report.generatedAt)} Mountain Time. Demonstration build: simulated data from fictional operators, not used by or affiliated with any city.
        </Text>
      </Page>
    </Document>
  );
}
