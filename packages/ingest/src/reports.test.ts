import { describe, expect, it } from "vitest";
import { parseReportCsv, reportedTrips } from "./reports";

const HEADER = "provider_id,start_date,duration,special_group_type,geography_id,vehicle_type,trip_count,rider_count";

describe("an operator's monthly report", () => {
  it("reads rows whatever order the columns come in", () => {
    const rows = parseReportCsv(`vehicle_type,rider_count,trip_count,special_group_type\nscooter_standing,900,1200,all_riders\r\nbicycle,40,55,low_income\n`);
    expect(rows).toEqual([
      { vehicleType: "scooter_standing", specialGroup: "all_riders", tripCount: 1200, riderCount: 900 },
      { vehicleType: "bicycle", specialGroup: "low_income", tripCount: 55, riderCount: 40 },
    ]);
  });

  it("refuses a report without the columns the audit depends on", () => {
    expect(() => parseReportCsv("vehicle_type,trip_count\nbicycle,3\n")).toThrow(/missing a column/);
  });

  it("refuses a count that is not a whole number rather than guessing", () => {
    expect(() => parseReportCsv(`${HEADER}\np,2026-10-01,P1M,all_riders,,bicycle,lots,4\n`)).toThrow(/not a whole number/);
  });

  it("sums only the all-riders rows, so special groups are not counted twice", () => {
    const rows = parseReportCsv(`${HEADER}\np,2026-10-01,P1M,all_riders,,scooter_standing,1000,700\np,2026-10-01,P1M,all_riders,,bicycle,250,200\np,2026-10-01,P1M,low_income,,bicycle,60,30\n`);
    expect(reportedTrips(rows)).toBe(1250);
  });

  it("treats a withheld small count (-1) as zero, never as minus one", () => {
    const rows = parseReportCsv(`${HEADER}\np,2026-10-01,P1M,all_riders,,scooter_standing,500,300\np,2026-10-01,P1M,all_riders,,bicycle,-1,-1\n`);
    expect(reportedTrips(rows)).toBe(500);
  });
});
