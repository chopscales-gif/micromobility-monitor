import { describe, expect, it } from "vitest";
import { verdict } from "./invoice";

const base = {
  operatorName: "Test Operator",
  observedTrips: 40_000,
  rejectedTripRecords: 0,
  schedule: { perRideCents: 20, discrepancyTolerancePct: 1, discrepancyToleranceTrips: 25 },
};

describe("the reading of a reconciliation", () => {
  it("waits when the operator has not reported", () => {
    expect(verdict({ ...base, reportedTrips: null, deltaTrips: null, feeAtRiskCents: null, flagged: false }).key).toBe("waiting");
  });

  it("agrees when the gap is inside the tolerance", () => {
    expect(verdict({ ...base, reportedTrips: 39_990, deltaTrips: 10, feeAtRiskCents: 200, flagged: false }).key).toBe("agree");
  });

  it("names the money when the operator reported fewer rides than it delivered records for", () => {
    const v = verdict({ ...base, reportedTrips: 38_883, deltaTrips: 1_117, feeAtRiskCents: 22_340, flagged: true });
    expect(v.key).toBe("disagree");
    expect(`${v.headline} ${v.explanation}`).toContain("1,117 fewer");
    expect(`${v.headline} ${v.explanation}`).toContain("$223.40");
  });

  it("points at rejected records when the operator reported more rides than the city could count", () => {
    const v = verdict({ ...base, reportedTrips: 40_609, deltaTrips: -609, feeAtRiskCents: 0, flagged: true, rejectedTripRecords: 733 });
    expect(v.key).toBe("disagree");
    expect(`${v.headline} ${v.explanation}`).toContain("609 more");
    expect(v.explanation).toContain("733");
    expect(v.explanation).toContain("$121.80");
  });
});
