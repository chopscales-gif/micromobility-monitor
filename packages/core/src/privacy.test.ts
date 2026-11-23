import { describe, expect, it } from "vitest";
import { K_ANONYMITY_MIN, protectBreakdown, publishable, publishableShare, roundCoord, routeRetentionDays, withheldTotal } from "./privacy";

describe("k-anonymity", () => {
  it("withholds any count from 1 to 9 and publishes 10", () => {
    for (let n = 1; n < K_ANONYMITY_MIN; n++) expect(publishable(n)).toBeNull();
    expect(publishable(10)).toBe(10);
    expect(publishable(4321)).toBe(4321);
  });

  it("keeps a zero, which describes nobody", () => {
    expect(publishable(0)).toBe(0);
  });

  it("leaves a breakdown alone when every cell is large enough", () => {
    expect(protectBreakdown([120, 45, 10, 0])).toEqual([120, 45, 10, 0]);
  });

  it("withholds a second cell when one small cell could be found by subtracting from the total", () => {
    // Publishing 120 and 45 beside a total of 168 would reveal the 3.
    expect(protectBreakdown([120, 45, 3])).toEqual([120, null, null]);
  });

  it("stops withholding once the hidden cells together reach the minimum", () => {
    const counts = [500, 6, 7, 30];
    const published = protectBreakdown(counts);
    expect(published).toEqual([500, null, null, 30]);
    expect(withheldTotal(counts, published)).toBe(13);
  });

  it("never publishes a hidden remainder smaller than the minimum, unless everything is hidden", () => {
    for (const counts of [[9], [1, 1, 1], [3, 11], [2, 0, 40, 12], [15, 9, 9, 200], [5, 5, 0, 0, 77]]) {
      const published = protectBreakdown(counts);
      const hidden = withheldTotal(counts, published);
      const anyShown = published.some((n) => n !== null && n > 0);
      expect(hidden === 0 || hidden >= K_ANONYMITY_MIN || !anyShown).toBe(true);
      published.forEach((n) => expect(n === null || n === 0 || n >= K_ANONYMITY_MIN).toBe(true));
    }
  });
});

describe("coordinate rounding", () => {
  it("keeps three decimal places, about a city block", () => {
    expect(roundCoord(-111.891234)).toBe(-111.891);
    expect(roundCoord(40.76078)).toBe(40.761);
  });

  it("does not leave a negative zero", () => {
    expect(Object.is(roundCoord(-0.0001), 0)).toBe(true);
  });
});

describe("shares", () => {
  it("publishes a share when both sides of the split are large enough", () => {
    expect(publishableShare(25, 100)).toBe(0.25);
    expect(publishableShare(0, 100)).toBe(0);
    expect(publishableShare(100, 100)).toBe(1);
  });

  it("withholds a share that would give away a small group on either side", () => {
    expect(publishableShare(3, 100)).toBeNull();
    expect(publishableShare(97, 100)).toBeNull();
    expect(publishableShare(0, 0)).toBeNull();
  });
});

describe("route keeping time", () => {
  it("is 90 days unless the setting says otherwise", () => {
    expect(routeRetentionDays(undefined)).toBe(90);
    expect(routeRetentionDays("30")).toBe(30);
    expect(routeRetentionDays("365")).toBe(365);
  });

  it("falls back to 90 days for a setting that is not a whole number of days", () => {
    for (const bad of ["", " ", "soon", "0", "-5", "1.5", "NaN", "Infinity"]) expect(routeRetentionDays(bad)).toBe(90);
  });
});
