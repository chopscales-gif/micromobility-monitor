// The files the public page offers, each made from the same published figures the page shows.

import { CITY_NAME } from "@mm/core/city";
import { K_ANONYMITY_MIN, PUBLIC_COORD_DECIMALS } from "@mm/core/privacy";
import type { OpenData } from "@/server/open-data";
import { TYPES } from "./meaning";
import { toCsv } from "./csv";

export const NOTICE = `Demonstration only: simulated data from fictional operators in a simulated ${CITY_NAME}. Not published by, or affiliated with, any city.`;
const RULES = `Counts under ${K_ANONYMITY_MIN} rides are withheld (blank), so parts may not add up to the total. Coordinates are rounded to ${PUBLIC_COORD_DECIMALS} decimal places.`;

export const FILES = [
  { file: "rides-by-day.csv", label: "Rides per day", format: "CSV" },
  { file: "rides-by-operator.csv", label: "Rides by operator and vehicle type", format: "CSV" },
  { file: "rides-by-hour.csv", label: "Rides by hour of the day", format: "CSV" },
  { file: "ride-areas.csv", label: "Where rides began and ended", format: "CSV" },
  { file: "ride-areas.geojson", label: "Where rides began and ended", format: "GeoJSON" },
] as const;
export type FileName = (typeof FILES)[number]["file"];

// A leading "#" line is skipped by the usual CSV readers when told that "#" marks a comment.
const csv = (rows: unknown[][]) => `# ${NOTICE}\r\n# ${RULES}\r\n${toCsv(rows)}`;

export function fileBody(data: OpenData, file: FileName): string {
  switch (file) {
    case "rides-by-day.csv":
      return csv([["date", "rides"], ...data.daily.map((d) => [d.date, d.trips])]);
    case "rides-by-operator.csv":
      return csv([["operator", ...data.types.map((t) => `${TYPES[t]?.toLowerCase() ?? "other"}_rides`), "all_rides", "vehicles"], ...data.operators.map((o) => [o.name, ...o.byType, o.trips, o.vehicles])]);
    case "rides-by-hour.csv":
      return csv([["hour_starting", "rides_on_weekdays", "rides_on_weekend_days", "weekdays_in_month", "weekend_days_in_month"], ...data.hours.map((h) => [h.hour, h.weekday, h.weekend, data.weekdays, data.weekendDays])]);
    case "ride-areas.csv":
      return csv([
        ["h3_cell", "centre_lat", "centre_lng", "end_of_ride", "rides"],
        ...data.starts.cells.map((c) => [c.h3, c.lat, c.lng, "began", c.trips]),
        ...data.ends.cells.map((c) => [c.h3, c.lat, c.lng, "ended", c.trips]),
      ]);
    case "ride-areas.geojson": {
      const features = (["starts", "ends"] as const).flatMap((end) =>
        data[end].cells.map((c) => ({ type: "Feature", geometry: { type: "Point", coordinates: [c.lng, c.lat] }, properties: { h3_cell: c.h3, end_of_ride: end === "starts" ? "began" : "ended", rides: c.trips } })),
      );
      return JSON.stringify({ type: "FeatureCollection", notice: NOTICE, rules: RULES, month: data.period, features }, null, 1);
    }
  }
}
