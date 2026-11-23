// The operator's own account of its month, from its MDS monthly report.

import type { IngestContext, Operator } from "./context";

export type ReportRow = { vehicleType: string; specialGroup: string; tripCount: number; riderCount: number };

export function parseReportCsv(csv: string): ReportRow[] {
  const [header, ...lines] = csv.trim().split(/\r?\n/);
  const columns = (header ?? "").split(",");
  const at = (name: string) => columns.indexOf(name);
  const need = ["special_group_type", "vehicle_type", "trip_count", "rider_count"];
  if (need.some((n) => at(n) < 0)) throw new Error(`Report is missing a column (needs ${need.join(", ")})`);
  return lines.filter(Boolean).map((line) => {
    const cells = line.split(",");
    const row = {
      vehicleType: cells[at("vehicle_type")] ?? "",
      specialGroup: cells[at("special_group_type")] ?? "",
      tripCount: Number(cells[at("trip_count")]),
      riderCount: Number(cells[at("rider_count")]),
    };
    if (!Number.isInteger(row.tripCount) || !Number.isInteger(row.riderCount)) throw new Error(`Report has a count that is not a whole number: ${line}`);
    return row;
  });
}

/**
 * Trips the operator says it carried: the sum of its "all riders" rows.
 * A count of -1 means "between 1 and 9, withheld", so it cannot be summed; it is counted as zero.
 */
export const reportedTrips = (rows: ReportRow[]) =>
  rows.filter((r) => r.specialGroup === "all_riders").reduce((sum, r) => sum + Math.max(0, r.tripCount), 0);

/** Fetches and stores a month's report. Returns false if the operator has not published it. */
export async function fetchReport(ctx: IngestContext, op: Operator, month: string): Promise<boolean> {
  const polledAt = new Date(ctx.now());
  const result = await ctx.fetch(`${op.mdsUrl}/reports/${month}.csv`, { authorization: `Bearer ${op.token}`, accept: "text/vnd.mds+csv;version=2.1" });
  let rows: ReportRow[] = [];
  let outcome = result.status === 0 ? "network_error" : result.status === 200 ? "ok" : "http_error";
  if (outcome === "ok") {
    try {
      rows = parseReportCsv(result.body);
    } catch {
      outcome = "envelope_invalid";
    }
  }
  if (result.status !== 404) {
    await ctx.sql`insert into feed_polls (operator_id, feed, polled_at, status_code, outcome, latency_ms, record_count)
      values (${op.id}, 'mds.reports', ${polledAt}, ${result.status || null}, ${outcome}, ${result.latencyMs}, ${rows.length})`;
  }
  if (outcome !== "ok") return false;
  for (const r of rows) {
    await ctx.sql`insert into operator_reports (operator_id, month, vehicle_type, special_group, trip_count, rider_count, fetched_at)
      values (${op.id}, ${month}, ${r.vehicleType}, ${r.specialGroup}, ${r.tripCount}, ${r.riderCount}, ${polledAt})
      on conflict (operator_id, month, vehicle_type, special_group) do update set trip_count = excluded.trip_count, rider_count = excluded.rider_count, fetched_at = excluded.fetched_at`;
  }
  return true;
}
