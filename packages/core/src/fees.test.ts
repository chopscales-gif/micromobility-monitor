import { describe, expect, it } from "vitest";
import {
  calculateInvoice,
  classifyTrip,
  deviceDaysInMonth,
  findDiscrepancy,
  formatCents,
  permitDaysInMonth,
  type FeeSchedule,
} from "./fees";

const schedule: FeeSchedule = {
  perDeviceAnnualCents: 3500,
  perRideCents: 20,
  minBillableTripSeconds: 60,
  exemptEquityZoneTrips: true,
  discrepancyTolerancePct: 0.5,
  discrepancyToleranceTrips: 5,
};

const ride = (durationSeconds = 600, touchesEquityZone = false) => ({ durationSeconds, touchesEquityZone });

describe("permit proration", () => {
  it("counts every day of the month for an open-ended permit", () => {
    expect(permitDaysInMonth({ id: "p", devices: 1, startDate: "2026-01-01", endDate: null }, 2026, 10)).toBe(31);
  });

  it("prorates a permit that starts mid-month, inclusive of the start day", () => {
    expect(permitDaysInMonth({ id: "p", devices: 1, startDate: "2026-10-16", endDate: null }, 2026, 10)).toBe(16);
  });

  it("prorates a permit that ends mid-month, inclusive of the end day", () => {
    expect(permitDaysInMonth({ id: "p", devices: 1, startDate: "2026-01-01", endDate: "2026-10-10" }, 2026, 10)).toBe(10);
  });

  it("is zero outside the permit's range", () => {
    expect(permitDaysInMonth({ id: "p", devices: 1, startDate: "2026-11-01", endDate: null }, 2026, 10)).toBe(0);
    expect(permitDaysInMonth({ id: "p", devices: 1, startDate: "2026-01-01", endDate: "2026-09-30" }, 2026, 10)).toBe(0);
  });

  it("handles February in a leap year", () => {
    expect(permitDaysInMonth({ id: "p", devices: 1, startDate: "2028-01-01", endDate: null }, 2028, 2)).toBe(29);
  });

  it("sums device-days across permits", () => {
    const permits = [
      { id: "a", devices: 500, startDate: "2026-01-01", endDate: null },
      { id: "b", devices: 100, startDate: "2026-10-16", endDate: null },
    ];
    expect(deviceDaysInMonth(permits, 2026, 10)).toBe(500 * 31 + 100 * 16);
  });
});

describe("trip classification", () => {
  it("bills an ordinary ride", () => {
    expect(classifyTrip(ride(), schedule)).toBe("billable");
  });
  it("exempts equity-zone rides when the schedule says so", () => {
    expect(classifyTrip(ride(600, true), schedule)).toBe("exempt_equity");
    expect(classifyTrip(ride(600, true), { ...schedule, exemptEquityZoneTrips: false })).toBe("billable");
  });
  it("exempts false starts, and a ride of exactly the minimum is billable", () => {
    expect(classifyTrip(ride(59), schedule)).toBe("exempt_short");
    expect(classifyTrip(ride(60), schedule)).toBe("billable");
  });
  it("treats a short equity-zone ride as a false start", () => {
    expect(classifyTrip(ride(10, true), schedule)).toBe("exempt_short");
  });
});

describe("invoice", () => {
  it("a full year of monthly invoices charges exactly the annual fee per device", () => {
    const permits = [{ id: "a", devices: 1000, startDate: "2026-01-01", endDate: null }];
    let total = 0;
    for (let month = 1; month <= 12; month++) {
      total += calculateInvoice({ year: 2026, month, schedule, permits, trips: [], reportedTrips: null }).totalCents;
    }
    // Twelve independent roundings can drift by at most a few cents on $35,000.
    expect(Math.abs(total - 1000 * 3500)).toBeLessThanOrEqual(6);
  });

  it("matches a hand-worked example", () => {
    // 600 devices for all 31 days of October 2026: 18,600 device-days.
    // 18,600 * $35 / 365 = $1,783.56 (rounded half up from 1783.5616).
    // 4 billable rides * $0.20 = $0.80. Total $1,784.36.
    const result = calculateInvoice({
      year: 2026,
      month: 10,
      schedule,
      permits: [{ id: "a", devices: 600, startDate: "2026-01-01", endDate: null }],
      trips: [ride(), ride(), ride(), ride(), ride(30), ride(900, true)],
      reportedTrips: 6,
    });
    expect(result.deviceDays).toBe(18_600);
    expect(result.lines[0]?.amountCents).toBe(178_356);
    expect(result.lines[1]?.amountCents).toBe(80);
    expect(result.totalCents).toBe(178_436);
    expect(result.tripCounts).toEqual({ observed: 6, billable: 4, exemptEquity: 1, exemptShort: 1 });
    expect(result.discrepancy?.flagged).toBe(false);
  });

  it("lines always add up to the total", () => {
    const result = calculateInvoice({
      year: 2026,
      month: 2,
      schedule,
      permits: [{ id: "a", devices: 333, startDate: "2026-02-07", endDate: "2026-02-19" }],
      trips: Array.from({ length: 1234 }, (_, i) => ride(30 + i, i % 7 === 0)),
      reportedTrips: null,
    });
    expect(result.lines.reduce((s, l) => s + l.amountCents, 0)).toBe(result.totalCents);
    expect(result.discrepancy).toBeNull();
  });
});

describe("discrepancy", () => {
  it("flags under-reporting beyond tolerance and prices it", () => {
    const d = findDiscrepancy(10_000, 9_700, schedule);
    expect(d.flagged).toBe(true);
    expect(d.deltaTrips).toBe(300);
    expect(d.deltaPct).toBeCloseTo(3);
    expect(d.feeAtRiskCents).toBe(6000);
  });
  it("tolerates small gaps", () => {
    expect(findDiscrepancy(10_000, 9_990, schedule).flagged).toBe(false); // 0.1%
    expect(findDiscrepancy(100, 96, schedule).flagged).toBe(false); // 4 trips, under the absolute floor
  });
  it("flags over-reporting too, with no fee at risk", () => {
    const d = findDiscrepancy(10_000, 10_400, schedule);
    expect(d.flagged).toBe(true);
    expect(d.feeAtRiskCents).toBe(0);
  });
  it("handles an operator with no observed trips", () => {
    expect(findDiscrepancy(0, 0, schedule).flagged).toBe(false);
    expect(findDiscrepancy(0, 50, schedule).flagged).toBe(true);
  });
});

describe("formatCents", () => {
  it("formats money", () => {
    expect(formatCents(178_436)).toBe("$1,784.36");
    expect(formatCents(5)).toBe("$0.05");
    expect(formatCents(-250)).toBe("-$2.50");
  });
});
