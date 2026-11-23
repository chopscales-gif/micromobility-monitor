import { describe, expect, it } from "vitest";
import { billingMonth, localDate, monthRange, startOfLocalDay } from "./city";

describe("the city's calendar", () => {
  it("a ride ending at 11:30 pm on 31 October is billed in October, though it is November in UTC", () => {
    const t = Date.parse("2026-11-01T05:30:00Z"); // 23:30 MDT on 31 October
    expect(localDate(t)).toBe("2026-10-31");
    expect(billingMonth(t)).toBe("2026-10");
  });

  it("finds local midnight on both sides of the clock change", () => {
    expect(new Date(startOfLocalDay("2026-10-31")).toISOString()).toBe("2026-10-31T06:00:00.000Z"); // daylight time
    expect(new Date(startOfLocalDay("2026-11-02")).toISOString()).toBe("2026-11-02T07:00:00.000Z"); // standard time
  });

  it("November 2026 is an hour longer than 30 days, because the clocks go back", () => {
    const { start, end } = monthRange(2026, 11);
    expect((end - start) / 3_600_000).toBe(30 * 24 + 1);
  });

  it("month ranges meet without gaps, across a year end", () => {
    expect(monthRange(2026, 12).end).toBe(monthRange(2027, 1).start);
  });
});
