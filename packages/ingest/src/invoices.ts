// Builds a month's invoice for one operator from the trips the city received,
// and sets it beside what the operator reported.

import { calculateInvoice, monthRange, type FeeSchedule, type Permit } from "@mm/core";
import type { Sql } from "@mm/db";

const pad = (n: number) => String(n).padStart(2, "0");

export async function scheduleFor(sql: Sql, year: number, month: number): Promise<FeeSchedule & { id: string }> {
  const lastDay = `${year}-${pad(month)}-${pad(new Date(Date.UTC(year, month, 0)).getUTCDate())}`;
  const [row] = await sql`select * from fee_schedules where effective_from <= ${lastDay} order by effective_from desc, created_at desc limit 1`;
  if (!row) throw new Error(`No fee schedule is in effect for ${year}-${pad(month)}`);
  return {
    id: row.id,
    perDeviceAnnualCents: row.per_device_annual_cents,
    perRideCents: row.per_ride_cents,
    minBillableTripSeconds: row.min_billable_trip_seconds,
    exemptEquityZoneTrips: row.exempt_equity_zone_trips,
    discrepancyTolerancePct: row.discrepancy_tolerance_pct,
    discrepancyToleranceTrips: row.discrepancy_tolerance_trips,
  };
}

export async function generateInvoice(sql: Sql, operator: { id: string; slug: string }, year: number, month: number, now = Date.now()): Promise<string> {
  const period = `${year}-${pad(month)}`;
  // An invoice that finance has signed off is a sent document: it is never recalculated.
  const [issued] = await sql`select id from invoices where operator_id = ${operator.id} and year = ${year} and month = ${month} and status = 'issued'`;
  if (issued) return issued.id as string;
  const { id: _scheduleId, ...schedule } = await scheduleFor(sql, year, month);

  const permitRows = await sql`select id, devices, start_date::text as start_date, end_date::text as end_date from permits where operator_id = ${operator.id}`;
  const permits: Permit[] = permitRows.map((p) => ({ id: p.id, devices: p.devices, startDate: p.start_date, endDate: p.end_date }));

  const trips = await sql`select duration_s, touches_equity_zone from trips where operator_id = ${operator.id} and billing_month = ${period}`;
  const reports = await sql`select trip_count from operator_reports where operator_id = ${operator.id} and month = ${period} and special_group = 'all_riders'`;
  const reported = reports.length === 0 ? null : reports.reduce((sum, r) => sum + Math.max(0, r.trip_count), 0);

  const range = monthRange(year, month);
  const [rejected] = await sql`select coalesce(sum(invalid_count), 0)::int as n from feed_polls
    where operator_id = ${operator.id} and feed = 'mds.trips' and period_hour >= ${new Date(range.start)} and period_hour < ${new Date(range.end)}`;

  const calc = calculateInvoice({
    year,
    month,
    schedule,
    permits,
    trips: trips.map((t) => ({ durationSeconds: t.duration_s, touchesEquityZone: t.touches_equity_zone })),
    reportedTrips: reported,
  });
  const d = calc.discrepancy;
  const number = `MM-${period}-${operator.slug.slice(0, 3).toUpperCase()}`;

  return sql.begin(async (tx) => {
    await tx`delete from invoices where operator_id = ${operator.id} and year = ${year} and month = ${month}`;
    const [invoice] = await tx`
      insert into invoices (number, operator_id, year, month, schedule, total_cents, device_days, observed_trips, billable_trips, exempt_equity_trips, exempt_short_trips,
        rejected_trip_records, reported_trips, delta_trips, delta_pct, fee_at_risk_cents, flagged, generated_at)
      values (${number}, ${operator.id}, ${year}, ${month}, ${tx.json(schedule)}, ${calc.totalCents}, ${calc.deviceDays}, ${calc.tripCounts.observed}, ${calc.tripCounts.billable},
        ${calc.tripCounts.exemptEquity}, ${calc.tripCounts.exemptShort}, ${rejected!.n}, ${d?.reportedTrips ?? null}, ${d?.deltaTrips ?? null}, ${d?.deltaPct ?? null},
        ${d?.feeAtRiskCents ?? null}, ${d?.flagged ?? false}, ${new Date(now)})
      returning id`;
    for (const [position, line] of calc.lines.entries()) {
      await tx`insert into invoice_lines (invoice_id, position, kind, description, quantity, unit_label, amount_cents)
        values (${invoice!.id}, ${position}, ${line.kind}, ${line.description}, ${line.quantity}, ${line.unitLabel}, ${line.amountCents})`;
    }
    return invoice!.id as string;
  });
}
