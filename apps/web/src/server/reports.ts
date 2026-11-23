// The monthly report: what the fleets did, how the operators kept to the rules, and what they owe.
// One function gathers it for the screen and for the PDF, so the two cannot disagree.

import { clock } from "@mm/core/clock";
import { can, type Actor } from "@mm/core/access";
import { CITY_TIME_ZONE, monthLabel, monthRange } from "@mm/core/city";
import { complianceRate, daysIn, isClosed, lastClosedMonth, parsePeriod, periodOf, utilization, weeksIn } from "@mm/core/reporting";
import { RULE_KINDS, RULES, type RuleKind } from "@mm/core/rules";
import { orderTypes } from "@/lib/report";
import { authorize } from "./guard";
import { sql } from "./db";

const DAY_MS = 86_400_000;
const scoped = (column: string, operatorId: string | null) => (operatorId ? sql`${sql(column)} = ${operatorId}` : sql`true`);

export type ReportMonth = { period: string; year: number; month: number; label: string; closed: boolean };

/** The months there are rides for, newest first. Asked without a permission: it says only which months exist. */
export async function reportMonths(now = clock()): Promise<ReportMonth[]> {
  const rows = await sql`select distinct billing_month from trips order by 1 desc`;
  return rows.flatMap((r) => {
    const parsed = parsePeriod(r.billing_month);
    return parsed ? [{ period: r.billing_month as string, ...parsed, label: monthLabel(parsed.year, parsed.month), closed: isClosed(parsed.year, parsed.month, now) }] : [];
  });
}

/** The month a report opens on when none is asked for: the newest finished one, or failing that the newest. */
export function defaultMonth(months: ReportMonth[], now = clock()): ReportMonth | null {
  const last = lastClosedMonth(now);
  return months.find((m) => m.period === periodOf(last.year, last.month)) ?? months.find((m) => m.closed) ?? months[0] ?? null;
}

export type Spread = { trips: number; vehicles: number; perVehicleDay: number | null; medianDistanceM: number | null; medianDurationS: number | null; equityTrips: number };
export type OperatorFigures = Spread & { slug: string; name: string };
export type Bucket = { label: string; trips: number };
export type Hour = { hour: number; weekday: number; weekend: number };
export type ComplianceRow = { slug: string; name: string; ruleWeeks: number; breached: number; rate: number | null; notices: number; byRule: Record<string, number> };
export type RevenueRow = { slug: string; name: string; number: string; status: "draft" | "issued"; deviceCents: number; rideCents: number; totalCents: number; billableTrips: number; exemptEquityTrips: number; waivedCents: number };

export type MonthlyReport = ReportMonth & {
  /** Days counted: the whole month once it is over, otherwise the days and part-day so far. */
  days: number;
  generatedAt: number;
  city: Spread;
  operators: OperatorFigures[];
  types: (Spread & { type: string })[];
  daily: { date: string; total: number; byOperator: Record<string, number> }[];
  busiest: { date: string; total: number } | null;
  quietest: { date: string; total: number } | null;
  distance: Bucket[];
  duration: Bucket[];
  hours: Hour[];
  peak: { weekday: Hour; weekend: Hour } | null;
  equityZones: { name: string; starts: number; ends: number }[];
  /** Null when the seat does not see cases. */
  compliance: { weeks: string[]; rules: { kind: RuleKind; label: string }[]; ruleWeeks: number; breached: number; rate: number | null; operators: ComplianceRow[] } | null;
  /** Null when the seat does not see invoices. */
  revenue: { rows: RevenueRow[]; totalCents: number; issuedCents: number; waivedCents: number } | null;
};

const DISTANCE_EDGES = [500, 1000, 2000, 3000, 5000];
const DISTANCE_LABELS = ["Under 0.5 km", "0.5 to 1 km", "1 to 2 km", "2 to 3 km", "3 to 5 km", "Over 5 km"];
const DURATION_EDGES = [300, 600, 900, 1200, 1800];
const DURATION_LABELS = ["Under 5 min", "5 to 10 min", "10 to 15 min", "15 to 20 min", "20 to 30 min", "Over 30 min"];

/**
 * Everything in the report for one month. Returns null for a month there are no rides for.
 * The sections on compliance and fees are left out for a seat that may not see cases or invoices.
 */
export async function monthlyReport(actor: Actor, period: string, action: "read" | "export" = "read", now = clock()): Promise<MonthlyReport | null> {
  const scope = await authorize(actor, action === "export" ? "reports.export" : "reports.view", { action, resource: "monthly_report", detail: { month: period, ...(action === "export" ? { format: "pdf" } : {}) } });
  const parsed = parsePeriod(period);
  if (!parsed) return null;
  const { year, month } = parsed;
  const { start, end } = monthRange(year, month);
  const closed = isClosed(year, month, now);
  const days = (Math.min(end, now) - start) / DAY_MS;
  const calendar = daysIn(year, month, now);
  const local = sql`(t.end_time at time zone ${CITY_TIME_ZONE})`;
  const startLocal = sql`(t.start_time at time zone ${CITY_TIME_ZONE})`;
  const inMonth = sql`t.billing_month = ${period} and ${scoped("t.operator_id", scope)}`;
  const seesCases = can(actor.role, "violations.view");
  const seesMoney = can(actor.role, "invoices.view");

  const [operatorRows, spreads, fleet, dailyRows, distanceRows, durationRows, hourRows, zoneRows, caseRows, ruleRows, invoiceRows] = await Promise.all([
    sql`select id, slug, name from operators o where ${scoped("o.id", scope)} order by name`,
    sql`select t.operator_id, t.vehicle_type, count(*)::int as trips, count(*) filter (where t.touches_equity_zone)::int as equity,
        percentile_cont(0.5) within group (order by t.distance_m) as distance, percentile_cont(0.5) within group (order by t.duration_s) as duration
      from trips t where ${inMonth} group by grouping sets ((t.operator_id), (t.vehicle_type), ())`,
    sql`select v.operator_id, v.vehicle_type, count(*)::int as n from vehicles v where v.first_seen < ${new Date(Math.min(end, now))} and v.last_seen >= ${new Date(start)} and ${scoped("v.operator_id", scope)} group by 1, 2`,
    sql`select ${local}::date::text as date, t.operator_id, count(*)::int as n from trips t where ${inMonth} group by 1, 2`,
    sql`select width_bucket(t.distance_m, ${DISTANCE_EDGES}::int[]) as b, count(*)::int as n from trips t where ${inMonth} group by 1`,
    sql`select width_bucket(t.duration_s, ${DURATION_EDGES}::int[]) as b, count(*)::int as n from trips t where ${inMonth} group by 1`,
    sql`select extract(hour from ${startLocal})::int as hour, extract(isodow from ${startLocal}) >= 6 as weekend, count(*)::int as n from trips t where ${inMonth} group by 1, 2`,
    sql`select z.name, count(*) filter (where st_contains(z.geom, st_setsrid(st_makepoint(t.start_lng, t.start_lat), 4326)))::int as starts,
        count(*) filter (where st_contains(z.geom, st_setsrid(st_makepoint(t.end_lng, t.end_lat), 4326)))::int as ends
      from zones z join trips t on ${inMonth} where z.type = 'equity' and z.effective_from < ${new Date(Math.min(end, now))} and (z.retired_at is null or z.retired_at > ${new Date(start)}) group by z.name order by z.name`,
    seesCases
      ? sql`select c.operator_id, c.rule_kind, c.notified_at is not null and c.outcome is distinct from 'withdrawn' as noticed,
          c.outcome is distinct from 'withdrawn' and exists (select 1 from violations v where v.case_id = c.id and v.standing = 'counted') as breached
        from cases c where c.week_start >= ${calendar[0]!}::date and c.week_start <= ${calendar.at(-1)!}::date and ${scoped("c.operator_id", scope)}`
      : [],
    seesCases ? sql`select kind from rules where enabled and effective_from < ${new Date(Math.min(end, now))}` : [],
    seesMoney
      ? sql`select i.operator_id, i.number, i.status, i.total_cents, i.billable_trips, i.exempt_equity_trips, (i.schedule->>'perRideCents')::int as per_ride,
          coalesce((select sum(l.amount_cents) from invoice_lines l where l.invoice_id = i.id and l.kind = 'device_permit'), 0)::int as device_cents,
          coalesce((select sum(l.amount_cents) from invoice_lines l where l.invoice_id = i.id and l.kind = 'rides'), 0)::int as ride_cents
        from invoices i where i.year = ${year} and i.month = ${month} and ${scoped("i.operator_id", scope)} and ${actor.role === "operator" ? sql`i.status = 'issued'` : sql`true`}`
      : [],
  ]);

  const total = spreads.find((s) => s.operator_id === null && s.vehicle_type === null);
  if (!total || total.trips === 0) return null;

  const vehiclesOf = (test: (v: Record<string, any>) => boolean) => fleet.filter(test).reduce((sum, v) => sum + v.n, 0);
  const spread = (row: Record<string, any> | undefined, vehicles: number): Spread => ({
    trips: row?.trips ?? 0,
    vehicles,
    perVehicleDay: utilization(row?.trips ?? 0, vehicles, days),
    medianDistanceM: row ? Number(row.distance) : null,
    medianDurationS: row ? Number(row.duration) : null,
    equityTrips: row?.equity ?? 0,
  });

  const operators: OperatorFigures[] = operatorRows
    .map((o) => ({ slug: o.slug as string, name: o.name as string, ...spread(spreads.find((s) => s.operator_id === o.id), vehiclesOf((v) => v.operator_id === o.id)) }))
    .sort((a, b) => b.trips - a.trips);
  const slugOf = new Map(operatorRows.map((o) => [o.id as string, o.slug as string]));
  const types = orderTypes([...spreads.flatMap((s) => (s.vehicle_type ? [s.vehicle_type as string] : [])), ...fleet.map((v) => v.vehicle_type as string)])
    .map((type) => ({ type, ...spread(spreads.find((s) => s.vehicle_type === type), vehiclesOf((v) => v.vehicle_type === type)) }))
    .filter((t) => t.trips > 0 || t.vehicles > 0);

  const daily = calendar.map((date) => {
    const byOperator: Record<string, number> = {};
    for (const r of dailyRows) if (r.date === date) byOperator[slugOf.get(r.operator_id)!] = r.n;
    return { date, total: Object.values(byOperator).reduce((a, b) => a + b, 0), byOperator };
  });
  // The day in progress would always look like the quietest.
  const whole = closed ? daily : daily.slice(0, -1);
  const ranked = [...whole].sort((a, b) => b.total - a.total);

  const buckets = (rows: Record<string, any>[], labels: string[]): Bucket[] => labels.map((label, b) => ({ label, trips: rows.find((r) => r.b === b)?.n ?? 0 }));

  const weekend = (date: string) => [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());
  const weekendDays = Math.max(1, calendar.filter(weekend).length);
  const weekdayDays = Math.max(1, calendar.length - calendar.filter(weekend).length);
  const hours: Hour[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    weekday: (hourRows.find((r) => r.hour === hour && !r.weekend)?.n ?? 0) / weekdayDays,
    weekend: (hourRows.find((r) => r.hour === hour && r.weekend)?.n ?? 0) / weekendDays,
  }));
  const top = (key: "weekday" | "weekend") => hours.reduce((best, h) => (h[key] > best[key] ? h : best), hours[0]!);

  let compliance: MonthlyReport["compliance"] = null;
  if (seesCases) {
    const weeks = weeksIn(year, month, now);
    const kinds = RULE_KINDS.filter((kind) => ruleRows.some((r) => r.kind === kind));
    const rows: ComplianceRow[] = operatorRows.map((o) => {
      const mine = caseRows.filter((c) => c.operator_id === o.id);
      const byRule = Object.fromEntries(kinds.map((kind) => [kind, mine.filter((c) => c.rule_kind === kind && c.breached).length]));
      const breached = Object.values(byRule).reduce((a, b) => a + b, 0);
      const ruleWeeks = kinds.length * weeks.length;
      return { slug: o.slug, name: o.name, ruleWeeks, breached, rate: complianceRate(ruleWeeks, breached), notices: mine.filter((c) => c.noticed).length, byRule };
    });
    const ruleWeeks = rows.reduce((sum, r) => sum + r.ruleWeeks, 0);
    const breached = rows.reduce((sum, r) => sum + r.breached, 0);
    compliance = { weeks, rules: kinds.map((kind) => ({ kind, label: RULES[kind].label })), ruleWeeks, breached, rate: complianceRate(ruleWeeks, breached), operators: rows.sort((a, b) => (a.rate ?? 1) - (b.rate ?? 1)) };
  }

  let revenue: MonthlyReport["revenue"] = null;
  if (seesMoney) {
    const rows: RevenueRow[] = invoiceRows
      .map((i) => {
        const o = operatorRows.find((x) => x.id === i.operator_id)!;
        return { slug: o.slug, name: o.name, number: i.number, status: i.status, deviceCents: i.device_cents, rideCents: i.ride_cents, totalCents: i.total_cents, billableTrips: i.billable_trips, exemptEquityTrips: i.exempt_equity_trips, waivedCents: i.exempt_equity_trips * i.per_ride };
      })
      .sort((a, b) => b.totalCents - a.totalCents);
    revenue = { rows, totalCents: rows.reduce((s, r) => s + r.totalCents, 0), issuedCents: rows.filter((r) => r.status === "issued").reduce((s, r) => s + r.totalCents, 0), waivedCents: rows.reduce((s, r) => s + r.waivedCents, 0) };
  }

  return {
    period, year, month, label: monthLabel(year, month), closed, days, generatedAt: now,
    city: spread(total, vehiclesOf(() => true)),
    operators, types, daily,
    busiest: ranked[0] ?? null,
    quietest: ranked.at(-1) ?? null,
    distance: buckets(distanceRows, DISTANCE_LABELS),
    duration: buckets(durationRows, DURATION_LABELS),
    hours,
    peak: hours.some((h) => h.weekday > 0 || h.weekend > 0) ? { weekday: top("weekday"), weekend: top("weekend") } : null,
    equityZones: zoneRows.map((z) => ({ name: z.name, starts: z.starts, ends: z.ends })),
    compliance, revenue,
  };
}
