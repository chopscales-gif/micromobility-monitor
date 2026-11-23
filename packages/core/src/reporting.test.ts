import { describe, expect, it } from "vitest";
import { startOfLocalDay } from "./city";
import { complianceRate, daysIn, isClosed, lastClosedMonth, median, parsePeriod, periodOf, utilization, weeksIn } from "./reporting";

const at = (date: string, hour = 12) => startOfLocalDay(date) + hour * 3_600_000;

describe("report periods", () => {
  it("reads a month and refuses anything else", () => {
    expect(parsePeriod("2026-10")).toEqual({ year: 2026, month: 10 });
    expect(parsePeriod("2026-13")).toBeNull();
    expect(parsePeriod("2026-1")).toBeNull();
    expect(parsePeriod("../etc")).toBeNull();
    expect(periodOf(2026, 3)).toBe("2026-03");
  });

  it("takes the last closed month in the city's time, across a year end", () => {
    expect(lastClosedMonth(at("2026-11-21"))).toEqual({ year: 2026, month: 10 });
    expect(lastClosedMonth(at("2027-01-01", 0))).toEqual({ year: 2026, month: 12 });
  });

  it("closes a month at local midnight, not UTC midnight", () => {
    expect(isClosed(2026, 10, at("2026-10-31", 23))).toBe(false);
    expect(isClosed(2026, 10, at("2026-11-01", 0))).toBe(true);
  });

  it("lists every day of a finished month and only the days begun of the current one", () => {
    expect(daysIn(2026, 10, at("2026-11-21"))).toHaveLength(31);
    const november = daysIn(2026, 11, at("2026-11-21"));
    expect(november).toHaveLength(21);
    expect(november.at(-1)).toBe("2026-11-21");
    expect(daysIn(2026, 11, at("2026-11-01", 0))).toEqual(["2026-11-01"]);
  });

  it("gives a rule week to the month its Monday falls in", () => {
    expect(weeksIn(2026, 10, at("2026-11-21"))).toEqual(["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"]);
    expect(weeksIn(2026, 11, at("2026-11-21"))).toEqual(["2026-11-02", "2026-11-09", "2026-11-16"]);
  });
});

describe("report figures", () => {
  it("works out rides per vehicle per day", () => {
    expect(utilization(62_000, 800, 31)).toBeCloseTo(2.5, 2);
    expect(utilization(100, 0, 31)).toBeNull();
    expect(utilization(100, 10, 0)).toBeNull();
  });

  it("works out the compliance rate from rule weeks", () => {
    expect(complianceRate(20, 7)).toBeCloseTo(0.65, 5);
    expect(complianceRate(20, 0)).toBe(1);
    expect(complianceRate(0, 0)).toBeNull();
    expect(complianceRate(5, 9)).toBe(0);
  });

  it("finds a median", () => {
    expect(median([1, 2, 9])).toBe(2);
    expect(median([1, 2, 4, 9])).toBe(3);
    expect(median([])).toBeNull();
  });
});
