import { describe, expect, it } from "vitest";
import { clock, clockStopped, parseClock } from "./clock";

describe("the demonstration clock", () => {
  it("is the real clock unless DEMO_CLOCK is set", () => {
    expect(parseClock(undefined)).toBeNull();
    expect(parseClock("  ")).toBeNull();
    if (!process.env.DEMO_CLOCK) {
      expect(clockStopped).toBe(false);
      expect(Math.abs(clock() - Date.now())).toBeLessThan(1000);
    }
  });

  it("reads an ISO instant", () => {
    expect(parseClock("2026-11-10T21:10:00Z")).toBe(Date.UTC(2026, 10, 10, 21, 10));
  });

  it("refuses a value that is not a time, so a typing mistake cannot pass for the real clock", () => {
    expect(() => parseClock("next tuesday")).toThrow(/DEMO_CLOCK/);
  });
});
