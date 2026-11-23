// Fee schedule, permits and invoices.

import { clock } from "@mm/core/clock";
import type { Actor } from "@mm/core/access";
import { localDate } from "@mm/core/city";
import { raiseAlerts } from "@mm/ingest/alerts";
import { generateInvoice } from "@mm/ingest/invoices";
import { authorize } from "./guard";
import { sql, sqlNow } from "./db";

const scoped = (column: string, operatorId: string | null) => (operatorId ? sql`${sql(column)} = ${operatorId}` : sql`true`);
/** An operator is shown an invoice once finance has issued it. Until then it is the city's working paper. */
const issuedFor = (actor: Actor) => (actor.role === "operator" ? sql`i.status = 'issued'` : sql`true`);

export type Schedule = {
  id: string;
  effectiveFrom: string;
  perDeviceAnnualCents: number;
  perRideCents: number;
  minBillableTripSeconds: number;
  exemptEquityZoneTrips: boolean;
  discrepancyTolerancePct: number;
  discrepancyToleranceTrips: number;
  note: string | null;
  createdBy: string;
  createdAt: number;
};

const schedule = (r: Record<string, any>): Schedule => ({
  id: r.id,
  effectiveFrom: r.effective_from,
  perDeviceAnnualCents: r.per_device_annual_cents,
  perRideCents: r.per_ride_cents,
  minBillableTripSeconds: r.min_billable_trip_seconds,
  exemptEquityZoneTrips: r.exempt_equity_zone_trips,
  discrepancyTolerancePct: r.discrepancy_tolerance_pct,
  discrepancyToleranceTrips: r.discrepancy_tolerance_trips,
  note: r.note,
  createdBy: r.created_by,
  createdAt: r.created_at.getTime(),
});

export async function feeSchedules(actor: Actor) {
  const scope = await authorize(actor, "fees.view", { action: "read", resource: "fee_schedule" });
  const [schedules, permits] = await Promise.all([
    sql`select id, effective_from::text as effective_from, per_device_annual_cents, per_ride_cents, min_billable_trip_seconds, exempt_equity_zone_trips,
      discrepancy_tolerance_pct, discrepancy_tolerance_trips, note, created_by, created_at from fee_schedules order by effective_from desc, created_at desc`,
    sql`select p.id, o.slug, o.name, p.devices, p.start_date::text as start_date, p.end_date::text as end_date, p.note
      from permits p join operators o on o.id = p.operator_id where ${scoped("p.operator_id", scope)} order by o.name, p.start_date`,
  ]);
  const today = localDate(clock());
  const list = schedules.map(schedule);
  return {
    current: list.find((s) => s.effectiveFrom <= today) ?? null,
    upcoming: list.filter((s) => s.effectiveFrom > today),
    history: list,
    permits: permits.map((p) => ({ id: p.id as string, operator: p.slug as string, operatorName: p.name as string, devices: p.devices as number, startDate: p.start_date as string, endDate: p.end_date as string | null, note: p.note as string | null })),
  };
}

export type ScheduleChange = Omit<Schedule, "id" | "createdBy" | "createdAt">;

export async function adoptSchedule(actor: Actor, change: ScheduleChange) {
  await authorize(actor, "fees.change", { action: "change", resource: "fee_schedule", detail: change });
  await sql`insert into fee_schedules (effective_from, per_device_annual_cents, per_ride_cents, min_billable_trip_seconds, exempt_equity_zone_trips,
      discrepancy_tolerance_pct, discrepancy_tolerance_trips, note, created_by, created_at)
    values (${change.effectiveFrom}, ${change.perDeviceAnnualCents}, ${change.perRideCents}, ${change.minBillableTripSeconds}, ${change.exemptEquityZoneTrips},
      ${change.discrepancyTolerancePct}, ${change.discrepancyToleranceTrips}, ${change.note}, ${actor.name}, ${sqlNow()})`;
}

/** A schedule that has not taken effect yet can be withdrawn; one that has been billed under cannot. */
export async function withdrawSchedule(actor: Actor, id: string): Promise<boolean> {
  const [row] = await sql`select id, effective_from::text as effective_from from fee_schedules where id = ${id} and effective_from > ${localDate(clock())}`;
  if (!row) return false;
  await authorize(actor, "fees.change", { action: "change", resource: "fee_schedule", detail: { change: "withdrawn", effectiveFrom: row.effective_from } });
  await sql`delete from fee_schedules where id = ${id}`;
  return true;
}

export type InvoiceSummary = {
  id: string;
  number: string;
  operator: string;
  operatorName: string;
  operatorId: string;
  year: number;
  month: number;
  totalCents: number;
  deviceDays: number;
  observedTrips: number;
  billableTrips: number;
  exemptEquityTrips: number;
  exemptShortTrips: number;
  rejectedTripRecords: number;
  reportedTrips: number | null;
  deltaTrips: number | null;
  deltaPct: number | null;
  feeAtRiskCents: number | null;
  flagged: boolean;
  generatedAt: number;
  /** draft until finance signs it off; issued after, and then never recalculated. */
  status: "draft" | "issued";
  issuedAt: number | null;
  issuedBy: string | null;
  issueNote: string | null;
  schedule: Omit<Schedule, "id" | "effectiveFrom" | "note" | "createdBy" | "createdAt">;
};

const invoice = (r: Record<string, any>): InvoiceSummary => ({
  id: r.id, number: r.number, operator: r.slug, operatorName: r.name, operatorId: r.operator_id, year: r.year, month: r.month, totalCents: r.total_cents,
  deviceDays: r.device_days, observedTrips: r.observed_trips, billableTrips: r.billable_trips, exemptEquityTrips: r.exempt_equity_trips, exemptShortTrips: r.exempt_short_trips,
  rejectedTripRecords: r.rejected_trip_records, reportedTrips: r.reported_trips, deltaTrips: r.delta_trips, deltaPct: r.delta_pct, feeAtRiskCents: r.fee_at_risk_cents,
  flagged: r.flagged, generatedAt: r.generated_at.getTime(), status: r.status, issuedAt: r.issued_at ? r.issued_at.getTime() : null, issuedBy: r.issued_by, issueNote: r.issue_note, schedule: r.schedule,
});

export async function invoiceList(actor: Actor): Promise<InvoiceSummary[]> {
  const scope = await authorize(actor, "invoices.view", { action: "read", resource: "invoice_list" });
  const rows = await sql`select i.*, o.slug, o.name from invoices i join operators o on o.id = i.operator_id where ${scoped("i.operator_id", scope)} and ${issuedFor(actor)} order by i.year desc, i.month desc, o.name`;
  return rows.map(invoice);
}

export type InvoiceDetail = InvoiceSummary & {
  lines: { kind: string; description: string; quantity: number; unitLabel: string; amountCents: number }[];
  permits: { devices: number; startDate: string; endDate: string | null; note: string | null }[];
  daily: { date: string; trips: number }[];
  rejected: { message: string; path: string; count: number }[];
};

/** Reads one invoice. `how` is recorded: looking at it and exporting it are different entries in the audit log. */
export async function invoiceDetail(actor: Actor, number: string, how: "read" | "export" = "read", format?: string): Promise<InvoiceDetail | null> {
  const [row] = await sql`select i.*, o.slug, o.name from invoices i join operators o on o.id = i.operator_id where i.number = ${number}`;
  if (!row) return null;
  const id = row.id as string;
  if (actor.role === "operator" && row.status !== "issued") {
    await authorize(actor, "invoices.view", { action: how, resource: "invoice", operatorId: row.operator_id, detail: { number: row.number, found: false }, withheld: true });
    return null;
  }
  await authorize(actor, how === "export" ? "invoices.export" : "invoices.view", { action: how, resource: "invoice", operatorId: row.operator_id, detail: { number: row.number, ...(format ? { format } : {}) } });
  const period = `${row.year}-${String(row.month).padStart(2, "0")}`;
  const [lines, permits, daily, rejected] = await Promise.all([
    sql`select kind, description, quantity, unit_label, amount_cents from invoice_lines where invoice_id = ${id} order by position`,
    sql`select devices, start_date::text as start_date, end_date::text as end_date, note from permits where operator_id = ${row.operator_id} order by start_date`,
    sql`select to_char(end_time at time zone 'America/Denver', 'YYYY-MM-DD') as date, count(*)::int as trips from trips where operator_id = ${row.operator_id} and billing_month = ${period} group by 1 order by 1`,
    sql`select e.message, e.path, sum(e.count)::int as count from schema_errors e join feed_polls p on p.id = e.poll_id
      where e.operator_id = ${row.operator_id} and e.feed = 'mds.trips' and to_char(p.period_hour at time zone 'America/Denver', 'YYYY-MM') = ${period} group by 1, 2 order by 3 desc`,
  ]);
  return {
    ...invoice(row),
    lines: lines.map((l) => ({ kind: l.kind, description: l.description, quantity: l.quantity, unitLabel: l.unit_label, amountCents: l.amount_cents })),
    permits: permits.map((p) => ({ devices: p.devices, startDate: p.start_date, endDate: p.end_date, note: p.note })),
    daily: daily.map((d) => ({ date: d.date, trips: d.trips })),
    rejected: rejected.map((r) => ({ message: r.message, path: r.path, count: r.count })),
  };
}

/** The trip-by-trip ledger behind an invoice: what an auditor would ask for. No routes, no rider details. */
export async function invoiceTrips(actor: Actor, number: string) {
  const [row] = await sql`select i.*, o.slug, o.name from invoices i join operators o on o.id = i.operator_id where i.number = ${number}`;
  if (!row) return null;
  if (actor.role === "operator" && row.status !== "issued") {
    await authorize(actor, "invoices.export", { action: "export", resource: "invoice_trip_ledger", operatorId: row.operator_id, detail: { number: row.number, found: false }, withheld: true });
    return null;
  }
  await authorize(actor, "invoices.export", { action: "export", resource: "invoice_trip_ledger", operatorId: row.operator_id, detail: { number: row.number, format: "csv" } });
  const period = `${row.year}-${String(row.month).padStart(2, "0")}`;
  const trips = await sql`select trip_id, device_id, vehicle_type, start_time, end_time, duration_s, distance_m, touches_equity_zone
    from trips where operator_id = ${row.operator_id} and billing_month = ${period} order by end_time`;
  return { invoice: invoice(row), trips };
}

/** Recalculates a draft from the trip records now on file. Returns a sentence when it cannot be done. */
export async function recalculateInvoice(actor: Actor, number: string): Promise<string | null> {
  const [row] = await sql`select i.operator_id, i.year, i.month, i.number, i.status, o.slug from invoices i join operators o on o.id = i.operator_id where i.number = ${number}`;
  if (!row) return "That invoice no longer exists.";
  await authorize(actor, "invoices.generate", { action: "change", resource: "invoice", operatorId: row.operator_id, detail: { number: row.number, change: "recalculated" } });
  if (row.status === "issued") return "This invoice has been issued. An issued invoice is a sent document and is not recalculated.";
  await generateInvoice(sql, { id: row.operator_id, slug: row.slug }, row.year, row.month);
  return null;
}

/**
 * Finance's sign-off. From here the invoice is the operator's to see and is never recalculated.
 * An invoice that does not reconcile can still be issued, but only with a note saying why.
 */
export async function issueInvoice(actor: Actor, number: string, note: string): Promise<string | null> {
  const [row] = await sql`select id, operator_id, number, status, flagged, reported_trips from invoices where number = ${number}`;
  if (!row) return "That invoice no longer exists.";
  await authorize(actor, "invoices.issue", { action: "change", resource: "invoice", operatorId: row.operator_id, detail: { number: row.number, change: "issued", flagged: row.flagged } });
  if (row.status === "issued") return "This invoice has already been issued.";
  const text = note.trim();
  if (row.flagged && !text) return "The operator's report does not agree with the city's count. Say why the invoice is being issued anyway: the note is kept with it.";
  if (row.reported_trips === null && !text) return "The operator has not filed its report. Say why the invoice is being issued without it.";
  const updated = await sql`update invoices set status = 'issued', issued_at = ${sqlNow()}, issued_by = ${actor.name}, issue_note = ${text || null} where id = ${row.id} and status = 'draft' returning id`;
  if (updated.length === 0) return "Someone else issued this invoice a moment ago.";
  await raiseAlerts(sql);
  return null;
}
