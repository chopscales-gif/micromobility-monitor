// The operator's own monthly usage report (MDS Provider /reports).
// This is the number the operator says it owes fees on. The city reconciles it
// against the trips it actually received through the /trips feed.

import { dayPlan } from "./plan";
import { providerId } from "./mds";
import { rng } from "./random";
import { addDays, localTime } from "./time";
import { SERVICE_AREA, type OperatorProfile } from "./world";
import { seededUuid } from "./random";

export type MonthlyReport = {
  month: string;
  rows: { specialGroup: "all_riders" | "low_income"; vehicleType: "scooter_standing" | "bicycle"; tripCount: number; riderCount: number }[];
  /** Trips the operator left out of its report. Known only to the simulator. */
  omitted: number;
};

const cache = new Map<string, MonthlyReport>();

export function monthlyReport(seed: string, op: OperatorProfile, month: string): MonthlyReport {
  const key = `${seed}|${op.slug}|${month}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const counts = { scooter: { all: 0, lowIncome: 0 }, bicycle: { all: 0, lowIncome: 0 } };
  let omitted = 0;
  const [y, m] = month.split("-").map(Number) as [number, number];
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  // Start a day early: a ride begun late on the last night of the previous month can end in this one.
  for (let date = addDays(`${month}-01`, -1); date <= `${month}-${String(lastDay).padStart(2, "0")}`; date = addDays(date, 1)) {
    const plan = dayPlan(seed, op, date);
    for (const trip of plan.trips) {
      if (!localTime(trip.endT).date.startsWith(month)) continue;
      const r = rng(seed, op.slug, "report", trip.id);
      if (r.chance(op.behaviour.underReport)) {
        omitted++;
        continue;
      }
      const bucket = counts[plan.vehicles[trip.vehicle]!.kind];
      bucket.all++;
      if (r.chance(0.04)) bucket.lowIncome++;
    }
  }

  const rows: MonthlyReport["rows"] = [];
  for (const [kind, vehicleType] of [["scooter", "scooter_standing"], ["bicycle", "bicycle"]] as const) {
    if ((kind === "scooter" ? op.scooters : op.bikes) === 0) continue;
    rows.push({ specialGroup: "all_riders", vehicleType, tripCount: counts[kind].all, riderCount: Math.round(counts[kind].all * 0.46) });
    rows.push({ specialGroup: "low_income", vehicleType, tripCount: counts[kind].lowIncome, riderCount: Math.round(counts[kind].lowIncome * 0.31) });
  }
  const report = { month, rows, omitted };
  cache.set(key, report);
  return report;
}

/** MDS says counts from 1 to 9 are published as -1, to protect small groups of riders. */
const redact = (n: number) => (n > 0 && n < 10 ? -1 : n);

export function monthlyReportCsv(seed: string, op: OperatorProfile, month: string): string {
  const geography = seededUuid("geography", SERVICE_AREA.slug);
  const lines = ["provider_id,start_date,duration,special_group_type,geography_id,vehicle_type,trip_count,rider_count"];
  for (const row of monthlyReport(seed, op, month).rows) {
    lines.push([providerId(op), `${month}-01`, "P1M", row.specialGroup, geography, row.vehicleType, redact(row.tripCount), redact(row.riderCount)].join(","));
  }
  return lines.join("\n") + "\n";
}
