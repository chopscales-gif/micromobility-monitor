// Fee calculation and audit. Pure functions, integer cents throughout; each
// invoice line is rounded once (half up) so the lines always add to the total.

export type FeeSchedule = {
  /** Annual permit fee per permitted device, in cents (e.g. 3500 = $35). */
  perDeviceAnnualCents: number;
  /** Fee per billable ride, in cents (e.g. 20 = $0.20). */
  perRideCents: number;
  /** Rides shorter than this are treated as false starts and not billed. */
  minBillableTripSeconds: number;
  /** Rides that start or end in an equity zone are not billed. */
  exemptEquityZoneTrips: boolean;
  /** Reported-vs-observed gap that is tolerated before a discrepancy is flagged. */
  discrepancyTolerancePct: number;
  discrepancyToleranceTrips: number;
};

/** A block of permitted devices, valid for an inclusive date range (YYYY-MM-DD). */
export type Permit = {
  id: string;
  devices: number;
  startDate: string;
  endDate: string | null;
};

export type TripForBilling = {
  durationSeconds: number;
  touchesEquityZone: boolean;
};

export type InvoiceLine = {
  kind: "device_permit" | "rides" | "exempt_equity" | "exempt_short";
  description: string;
  quantity: number;
  unitLabel: string;
  amountCents: number;
};

export type Discrepancy = {
  observedTrips: number;
  reportedTrips: number;
  deltaTrips: number;
  deltaPct: number;
  /** Fee the city would have missed had it billed on the operator's own count. */
  feeAtRiskCents: number;
  flagged: boolean;
};

export type InvoiceCalculation = {
  period: { year: number; month: number };
  lines: InvoiceLine[];
  totalCents: number;
  tripCounts: { observed: number; billable: number; exemptEquity: number; exemptShort: number };
  deviceDays: number;
  discrepancy: Discrepancy | null;
};

const DAY_MS = 86_400_000;

function utcDay(date: string): number {
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(ms)) throw new Error(`Invalid date: ${date}`);
  return ms;
}

export function daysInYear(year: number): number {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function roundHalfUp(numerator: number, denominator: number): number {
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

/** Number of days a permit is in force inside the given month (inclusive ends). */
export function permitDaysInMonth(permit: Permit, year: number, month: number): number {
  const monthStart = Date.UTC(year, month - 1, 1);
  const monthEnd = Date.UTC(year, month - 1, daysInMonth(year, month));
  const start = Math.max(utcDay(permit.startDate), monthStart);
  const end = Math.min(permit.endDate ? utcDay(permit.endDate) : monthEnd, monthEnd);
  return end < start ? 0 : Math.round((end - start) / DAY_MS) + 1;
}

/** Total device-days across all permits for the month. */
export function deviceDaysInMonth(permits: Permit[], year: number, month: number): number {
  return permits.reduce((sum, p) => sum + p.devices * permitDaysInMonth(p, year, month), 0);
}

export function classifyTrip(
  trip: TripForBilling,
  schedule: FeeSchedule,
): "billable" | "exempt_equity" | "exempt_short" {
  // Short rides are checked first: a false start is not a ride, wherever it happened.
  if (trip.durationSeconds < schedule.minBillableTripSeconds) return "exempt_short";
  if (schedule.exemptEquityZoneTrips && trip.touchesEquityZone) return "exempt_equity";
  return "billable";
}

export function findDiscrepancy(
  observedTrips: number,
  reportedTrips: number,
  schedule: FeeSchedule,
): Discrepancy {
  const deltaTrips = observedTrips - reportedTrips;
  const deltaPct = observedTrips === 0 ? (reportedTrips === 0 ? 0 : 100) : (Math.abs(deltaTrips) / observedTrips) * 100;
  const flagged =
    Math.abs(deltaTrips) > schedule.discrepancyToleranceTrips && deltaPct > schedule.discrepancyTolerancePct;
  return {
    observedTrips,
    reportedTrips,
    deltaTrips,
    deltaPct,
    feeAtRiskCents: Math.max(0, deltaTrips) * schedule.perRideCents,
    flagged,
  };
}

export function calculateInvoice(input: {
  year: number;
  month: number;
  schedule: FeeSchedule;
  permits: Permit[];
  trips: TripForBilling[];
  /** Trip count the operator reported for the month, if it has filed one. */
  reportedTrips: number | null;
}): InvoiceCalculation {
  const { year, month, schedule, permits, trips, reportedTrips } = input;

  const deviceDays = deviceDaysInMonth(permits, year, month);
  const permitCents = roundHalfUp(deviceDays * schedule.perDeviceAnnualCents, daysInYear(year));

  const counts = { billable: 0, exempt_equity: 0, exempt_short: 0 };
  for (const trip of trips) counts[classifyTrip(trip, schedule)] += 1;

  const lines: InvoiceLine[] = [
    {
      kind: "device_permit",
      description: `Device permit fee, prorated by days in force (${formatCents(schedule.perDeviceAnnualCents)} per device per year)`,
      quantity: deviceDays,
      unitLabel: "device-days",
      amountCents: permitCents,
    },
    {
      kind: "rides",
      description: `Per-ride fee (${formatCents(schedule.perRideCents)} per ride)`,
      quantity: counts.billable,
      unitLabel: "rides",
      amountCents: counts.billable * schedule.perRideCents,
    },
  ];
  if (counts.exempt_equity > 0) {
    lines.push({
      kind: "exempt_equity",
      description: "Exempt: rides starting or ending in an equity zone",
      quantity: counts.exempt_equity,
      unitLabel: "rides",
      amountCents: 0,
    });
  }
  if (counts.exempt_short > 0) {
    lines.push({
      kind: "exempt_short",
      description: `Exempt: rides under ${schedule.minBillableTripSeconds} seconds`,
      quantity: counts.exempt_short,
      unitLabel: "rides",
      amountCents: 0,
    });
  }

  return {
    period: { year, month },
    lines,
    totalCents: lines.reduce((sum, l) => sum + l.amountCents, 0),
    tripCounts: {
      observed: trips.length,
      billable: counts.billable,
      exemptEquity: counts.exempt_equity,
      exemptShort: counts.exempt_short,
    },
    deviceDays,
    discrepancy: reportedTrips === null ? null : findDiscrepancy(trips.length, reportedTrips, schedule),
  };
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}
