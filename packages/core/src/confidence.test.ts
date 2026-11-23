import { describe, expect, it } from "vitest";
import { assessCount, assessDwell, assessLag, assessSla, misparkMarginMeters, rejectedShare } from "./confidence";
import { boundaryDistanceMeters, type Polygon } from "./geo";
import type { RuleZone, Stay } from "./rules";

// A square about 111 m on a side at the equator, so distances are easy to read.
const square: Polygon = [[[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001], [0, 0]]];
const zone = (type: string): RuleZone => ({ id: type, name: type, type, polygons: [square], speedLimitKph: null, effectiveFrom: 0, retiredAt: null });
const stay = (lng: number, lat: number, outside = false): Stay => ({ deviceId: "d", from: 1000, to: null, lng, lat, outside, lastState: "available" });
const HOUR = 3_600_000;

describe("distance to a zone's edge", () => {
  it("is measured to the nearest edge from either side", () => {
    expect(boundaryDistanceMeters([0.0005, 0.00005], [square])).toBeCloseTo(5.56, 1);
    expect(boundaryDistanceMeters([0.0005, -0.00005], [square])).toBeCloseTo(5.56, 1);
    expect(boundaryDistanceMeters([0.0005, 0.0005], [square])).toBeCloseTo(55.6, 0);
  });
});

describe("badly parked vehicles near a line", () => {
  it("measures a vehicle in a no-parking zone against that zone's edge", () => {
    expect(misparkMarginMeters(stay(0.0005, 0.00005), "no_parking", [zone("no_parking")])).toBeCloseTo(5.56, 1);
  });
  it("measures a vehicle outside the service area against the service area's edge", () => {
    expect(misparkMarginMeters(stay(0.0005, -0.00002), "outside_area", [zone("service_area")])).toBeCloseTo(2.2, 1);
  });
  it("takes the operator's word when it reported the vehicle outside the area itself", () => {
    expect(misparkMarginMeters(stay(0.0005, -0.00002, true), "outside_area", [zone("service_area")])).toBeNull();
  });
  it("ignores a zone that was not in force when the vehicle was left", () => {
    expect(misparkMarginMeters(stay(0.0005, 0.00005), "no_parking", [{ ...zone("no_parking"), effectiveFrom: 5000 }])).toBeNull();
  });
});

describe("holding a day of missed deadlines", () => {
  it("holds the day when the vehicles inside the GPS margin are what broke the allowance", () => {
    expect(assessSla([50, 40, 30, 80, 60, 4], 5)).toEqual({ code: "gps_margin", marginMeters: 15, marginal: 1, firm: 5, allowance: 5 });
  });
  it("lets the day stand when it would be broken without them", () => {
    expect(assessSla([50, 40, 30, 80, 60, 70, 4], 5)).toBeNull();
  });
  it("counts a vehicle the operator reported outside the area as firm", () => {
    expect(assessSla([null, null, null, null, null, null], 5)).toBeNull();
  });
});

describe("holding a parked vehicle", () => {
  it("holds it when records went missing during the stay", () => {
    expect(assessDwell(2.64)).toEqual({ code: "record_loss", rejectedPct: 2.6, limitPct: 1 });
  });
  it("lets it stand when the record is nearly complete", () => {
    expect(assessDwell(0.4)).toBeNull();
    expect(assessDwell(0)).toBeNull();
  });
});

describe("holding a count", () => {
  it("holds a count over the cap by less than the share of records lost", () => {
    expect(assessCount(551, 550, 0.4)).toEqual({ code: "within_loss", rejectedPct: 0.4, marginPct: 0.2 });
  });
  it("lets a clear breach stand", () => {
    expect(assessCount(594, 550, 0.4)).toBeNull();
  });
  it("works for a share that fell short as well as a count that went over", () => {
    expect(assessCount(9.8, 10, 2.6)).not.toBeNull();
    expect(assessCount(5, 10, 2.6)).toBeNull();
  });
  it("never holds when no records were lost", () => {
    expect(assessCount(551, 550, 0)).toBeNull();
  });
});

describe("holding while the feed is behind", () => {
  const now = 100 * HOUR;
  it("holds a period the record has not reached", () => {
    expect(assessLag(null, now - 5 * HOUR, now)).toEqual({ code: "record_behind", hoursBehind: 5 });
    expect(assessLag(now - HOUR, now - 5 * HOUR, now)).not.toBeNull();
  });
  it("lets a period stand that ended before the gap", () => {
    expect(assessLag(now - 10 * HOUR, now - 5 * HOUR, now)).toBeNull();
  });
  it("does nothing while the feed is on time", () => {
    expect(assessLag(null, now - HOUR, now)).toBeNull();
  });
});

describe("share of records rejected", () => {
  it("counts only the hours that overlap the period", () => {
    const hours = [{ hour: 0, records: 100, rejected: 50 }, { hour: HOUR, records: 100, rejected: 2 }, { hour: 2 * HOUR, records: 100, rejected: 4 }];
    expect(rejectedShare(hours, HOUR, 3 * HOUR)).toBe(3);
    expect(rejectedShare(hours, 10 * HOUR, 11 * HOUR)).toBe(0);
  });
});
