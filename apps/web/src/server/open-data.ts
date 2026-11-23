// What the public may see: counts for finished months, never a ride. There is no seat here and
// nothing is written to the audit log, because nothing on this side of the wall is about a person.
//
// Every figure leaves through the same three rules (packages/core/src/privacy.ts):
//   a count of fewer than ten rides is withheld, and so is the next smallest where the total would give it away;
//   places are hexagons about 900 metres across, named by a centre rounded to three decimal places;
//   distances and durations are published as one middle value for the month, rounded.

import { clock } from "@mm/core/clock";
import { CITY_TIME_ZONE, monthLabel, monthRange } from "@mm/core/city";
import { K_ANONYMITY_MIN, protectBreakdown, PUBLIC_H3_RESOLUTION, publishableShare, roundCoord, withheldTotal } from "@mm/core/privacy";
import { daysIn, isClosed, parsePeriod, utilization } from "@mm/core/reporting";
import { cellToLatLng, cellToParent } from "h3-js";
import { orderTypes } from "@/lib/report";
import { sql } from "./db";

export type PublicMonth = { period: string; label: string };
export type PublicCell = { h3: string; lat: number; lng: number; trips: number };
export type PublicPlaces = { cells: PublicCell[]; withheldCells: number; withheldTrips: number };

export type OpenData = PublicMonth & {
  generatedAt: number;
  trips: number;
  vehicles: number;
  perVehicleDay: number | null;
  medianDistanceKm: number;
  medianDurationMin: number;
  /** Share of rides that started, ended or passed through an equity zone. Null when either side of the split was too small to publish. */
  equityShare: number | null;
  types: string[];
  /** Rides by operator and vehicle type. A null was too small to publish. */
  operators: { slug: string; name: string; trips: number; vehicles: number | null; byType: (number | null)[] }[];
  /** Operators left out of the list: too few rides, or needed to keep another's count from being worked out. */
  operatorsWithheld: number;
  daily: { date: string; trips: number | null }[];
  /** Rides started in each hour, summed over the month's weekdays and over its weekend days. */
  hours: { hour: number; weekday: number | null; weekend: number | null }[];
  weekdays: number;
  weekendDays: number;
  starts: PublicPlaces;
  ends: PublicPlaces;
};

/** Finished months with enough rides on record to publish, newest first. A month still running is never published. */
export async function publicMonths(now = clock()): Promise<PublicMonth[]> {
  const rows = await sql`select billing_month from trips group by 1 having count(*) >= ${K_ANONYMITY_MIN} order by 1 desc`;
  return rows.flatMap((r) => {
    const p = parsePeriod(r.billing_month);
    return p && isClosed(p.year, p.month, now) ? [{ period: r.billing_month as string, label: monthLabel(p.year, p.month) }] : [];
  });
}

/** Counts per fine hexagon, gathered into the coarser public hexagons and then protected. */
function places(rows: { cell: string; n: number }[]): PublicPlaces {
  const coarse = new Map<string, number>();
  for (const r of rows) {
    const parent = cellToParent(r.cell, PUBLIC_H3_RESOLUTION);
    coarse.set(parent, (coarse.get(parent) ?? 0) + r.n);
  }
  const ids = [...coarse.keys()];
  const counts = ids.map((id) => coarse.get(id)!);
  const published = protectBreakdown(counts);
  const cells = ids
    .flatMap((h3, i) => {
      const trips = published[i];
      if (trips === null || trips === undefined) return [];
      const [lat, lng] = cellToLatLng(h3);
      return [{ h3, lat: roundCoord(lat), lng: roundCoord(lng), trips }];
    })
    .sort((a, b) => b.trips - a.trips);
  return { cells, withheldCells: published.filter((p) => p === null).length, withheldTrips: withheldTotal(counts, published) };
}

// A finished month does not change, and the page has no seat to vary by, so it is worked out once and kept a while.
const kept = new Map<string, { at: number; data: OpenData }>();
const KEEP_MS = 10 * 60_000;

/** The published figures for one finished month, or null if there is no such month. */
export async function openData(period: string, now = clock()): Promise<OpenData | null> {
  const parsed = parsePeriod(period);
  if (!parsed || !isClosed(parsed.year, parsed.month, now)) return null;
  const cached = kept.get(period);
  if (cached && now - cached.at < KEEP_MS) return cached.data;

  const { year, month } = parsed;
  const { start, end } = monthRange(year, month);
  const calendar = daysIn(year, month, now);
  const startLocal = sql`(t.start_time at time zone ${CITY_TIME_ZONE})`;
  const [operatorRows, cross, fleet, total, dailyRows, hourRows, startRows, endRows] = await Promise.all([
    sql`select id, slug, name from operators order by name`,
    sql`select operator_id, vehicle_type, count(*)::int as n from trips t where t.billing_month = ${period} group by 1, 2`,
    sql`select operator_id, count(*)::int as n from vehicles where first_seen < ${new Date(end)} and last_seen >= ${new Date(start)} group by 1`,
    sql`select count(*)::int as trips, count(*) filter (where touches_equity_zone)::int as equity,
        percentile_cont(0.5) within group (order by distance_m) as distance, percentile_cont(0.5) within group (order by duration_s) as duration
      from trips t where t.billing_month = ${period}`,
    sql`select (t.end_time at time zone ${CITY_TIME_ZONE})::date::text as date, count(*)::int as n from trips t where t.billing_month = ${period} group by 1`,
    sql`select extract(hour from ${startLocal})::int as hour, extract(isodow from ${startLocal}) >= 6 as weekend, count(*)::int as n from trips t where t.billing_month = ${period} group by 1, 2`,
    sql<{ cell: string; n: number }[]>`select start_h3 as cell, count(*)::int as n from trips t where t.billing_month = ${period} and start_h3 is not null group by 1`,
    sql<{ cell: string; n: number }[]>`select end_h3 as cell, count(*)::int as n from trips t where t.billing_month = ${period} and end_h3 is not null group by 1`,
  ]);
  const all = total[0];
  if (!all || all.trips < K_ANONYMITY_MIN) return null;

  const types = orderTypes(cross.map((c) => c.vehicle_type as string));
  const perOperator = operatorRows.map((o) => {
    const counts = types.map((type) => cross.find((c) => c.operator_id === o.id && c.vehicle_type === type)?.n ?? 0);
    return { slug: o.slug as string, name: o.name as string, counts, trips: counts.reduce((a, b) => a + b, 0), fleet: fleet.find((f) => f.operator_id === o.id)?.n ?? 0 };
  });
  // The city's total is published, so an operator's count is protected as one part of it: a small one is left out,
  // and the next smallest with it where the total would otherwise give the small one away.
  const operatorTotals = protectBreakdown(perOperator.map((o) => o.trips));
  const fleets = protectBreakdown(perOperator.map((o) => o.fleet));
  const operators = perOperator
    .flatMap((o, i) => (operatorTotals[i] === null || o.trips === 0 ? [] : [{ slug: o.slug, name: o.name, trips: o.trips, vehicles: fleets[i] ?? null, byType: protectBreakdown(o.counts) }]))
    .sort((a, b) => b.trips - a.trips);
  const daily = protectBreakdown(calendar.map((date) => dailyRows.find((r) => r.date === date)?.n ?? 0));

  const hourCounts = (weekend: boolean) => protectBreakdown(Array.from({ length: 24 }, (_, hour) => hourRows.find((r) => r.hour === hour && r.weekend === weekend)?.n ?? 0));
  const weekday = hourCounts(false);
  const weekendCounts = hourCounts(true);
  const weekendDays = calendar.filter((date) => [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay())).length;
  const vehicles = perOperator.reduce((sum, o) => sum + o.fleet, 0);

  const data: OpenData = {
    period,
    label: monthLabel(year, month),
    generatedAt: now,
    trips: all.trips,
    vehicles,
    perVehicleDay: utilization(all.trips, vehicles, calendar.length),
    medianDistanceKm: Math.round(Number(all.distance) / 100) / 10,
    medianDurationMin: Math.round(Number(all.duration) / 60),
    equityShare: publishableShare(all.equity, all.trips),
    types,
    operators,
    operatorsWithheld: operatorTotals.filter((t) => t === null).length,
    daily: calendar.map((date, i) => ({ date, trips: daily[i] ?? null })),
    hours: Array.from({ length: 24 }, (_, hour) => ({ hour, weekday: weekday[hour] ?? null, weekend: weekendCounts[hour] ?? null })),
    weekdays: calendar.length - weekendDays,
    weekendDays,
    starts: places(startRows),
    ends: places(endRows),
  };
  kept.set(period, { at: now, data });
  return data;
}
