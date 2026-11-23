import { classifyTrip } from "@mm/core/fees";
import { csvResponse, toCsv } from "@/lib/csv";
import { download } from "@/server/download";
import { invoiceTrips } from "@/server/fees";
import { currentPerson } from "@/server/session";

// One row per trip behind the invoice. Deliberately no start or end points and no route.
export async function GET(_request: Request, { params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  return download(async () => {
    const ledger = await invoiceTrips(await currentPerson(), number);
    if (!ledger) return null;
    const BILLING = { billable: "billable", exempt_short: "exempt: too short", exempt_equity: "exempt: equity zone" };
    return csvResponse(
      `${ledger.invoice.number}-trips.csv`,
      toCsv([
        ["trip_id", "device_id", "vehicle_type", "start_time_utc", "end_time_utc", "duration_seconds", "distance_metres", "equity_zone", "billing"],
        ...ledger.trips.map((t) => [
          t.trip_id,
          t.device_id,
          t.vehicle_type,
          t.start_time,
          t.end_time,
          t.duration_s,
          t.distance_m,
          t.touches_equity_zone ? "yes" : "no",
          // The same rule the invoice itself was calculated with.
          BILLING[classifyTrip({ durationSeconds: t.duration_s, touchesEquityZone: t.touches_equity_zone }, ledger.invoice.schedule)],
        ]),
      ]),
    );
  });
}
