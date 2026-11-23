// The record of what happened: each finished hour's status changes, location
// points and completed trips, published by the operator a few minutes after the hour.

import { billingMonth, SPEED_GAP, zonePasses } from "@mm/core";
import { latLngToCell } from "h3-js";
import { insertRows, type IngestContext, type Operator, type RoutePoint } from "./context";
import { pollFeed } from "./poll";
import { eventRow, H3_RESOLUTION } from "./realtime";

const HOUR_MS = 3_600_000;
/** Raw location points are only needed until the trip they belong to has been filed. */
export const TELEMETRY_KEEP_MS = 48 * HOUR_MS;

type Location = { lat: number; lng: number; speed?: number };
type MdsTrip = {
  trip_id: string;
  device_id: string;
  start_time: number;
  end_time: number;
  start_location: Location;
  end_location: Location;
  duration: number;
  distance: number;
};
type MdsTelemetry = {
  telemetry_id: string;
  device_id: string;
  timestamp: number;
  trip_ids?: string[] | null;
  location: Location;
  battery_percent?: number;
};

const hourParam = (hour: number) => new Date(hour).toISOString().slice(0, 13);

export type HourResult = "done" | "not_ready" | "failed";

/**
 * Ingests one finished hour. Safe to repeat: every insert ignores rows it already has.
 * With `routes: false` the location points are skipped, so trips are stored without a path.
 * `keepPoints` says whether the raw points are also written to the telemetry table (by default, only for recent hours).
 */
export async function ingestHour(ctx: IngestContext, op: Operator, hour: number, options: { routes: boolean; keepPoints?: boolean }): Promise<HourResult> {
  const period = { periodHour: hour };
  const blocked = (outcome: string) => (outcome === "not_ready" ? "not_ready" : outcome === "http_error" || outcome === "network_error" ? "failed" : null);

  const events = await pollFeed<Parameters<typeof eventRow>[1]>(ctx, op, "mds.events_historical", `${op.mdsUrl}/events/historical?event_time=${hourParam(hour)}`, period);
  if (blocked(events.outcome)) return blocked(events.outcome)!;
  await insertRows(ctx.sql, "status_events", events.records.map((e) => eventRow(op, e)), "on conflict (event_id) do nothing");

  // Location points arrive by the hour, but a ride can span two. Points for rides still
  // in progress wait in memory (and, for recent hours, in the telemetry table) until the ride is filed.
  const paths = new Map<string, RoutePoint[]>();
  if (options.routes) {
    const telemetry = await pollFeed<MdsTelemetry>(ctx, op, "mds.telemetry", `${op.mdsUrl}/telemetry?telemetry_time=${hourParam(hour)}`, period);
    if (blocked(telemetry.outcome)) return blocked(telemetry.outcome)!;
    for (const t of telemetry.records) {
      const tripId = t.trip_ids?.[0];
      if (!tripId) continue;
      const point: RoutePoint = [t.timestamp, t.location.lng, t.location.lat, t.location.speed ?? null];
      const path = ctx.pendingRoutes.get(tripId);
      if (path) path.push(point);
      else ctx.pendingRoutes.set(tripId, [point]);
    }
    if (options.keepPoints ?? ctx.now() - hour < TELEMETRY_KEEP_MS) {
      const rows = telemetry.records.map((t) => ({
        telemetry_id: t.telemetry_id,
        operator_id: op.id,
        device_id: t.device_id,
        trip_id: t.trip_ids?.[0] ?? null,
        ts: new Date(t.timestamp),
        lng: t.location.lng,
        lat: t.location.lat,
        speed_mps: t.location.speed ?? null,
        battery: t.battery_percent ?? null,
      }));
      await insertRows(ctx.sql, "telemetry", rows, "on conflict (telemetry_id) do nothing");
    }
  }

  const trips = await pollFeed<MdsTrip>(ctx, op, "mds.trips", `${op.mdsUrl}/trips?end_time=${hourParam(hour)}`, period);
  if (blocked(trips.outcome)) return blocked(trips.outcome)!;

  if (options.routes) {
    // A ride that began before this process started has its earlier points in the table, not in memory.
    const early = trips.records.filter((t) => t.start_time < hour && (ctx.pendingRoutes.get(t.trip_id)?.[0]?.[0] ?? Infinity) > t.start_time + 60_000);
    if (early.length > 0) {
      const stored = await ctx.sql`select trip_id, ts, lng, lat, speed_mps from telemetry where trip_id = any(${early.map((t) => t.trip_id)}::uuid[]) and ts < ${new Date(hour)}`;
      for (const r of stored) {
        const path = ctx.pendingRoutes.get(r.trip_id) ?? [];
        path.push([r.ts.getTime(), r.lng, r.lat, r.speed_mps]);
        ctx.pendingRoutes.set(r.trip_id, path);
      }
    }
    for (const t of trips.records) {
      const path = ctx.pendingRoutes.get(t.trip_id);
      if (path) paths.set(t.trip_id, path.sort((a, b) => a[0] - b[0]));
      ctx.pendingRoutes.delete(t.trip_id);
    }
    // Points for rides that never got filed (a rejected trip record, say) are not kept waiting for ever.
    for (const [tripId, path] of ctx.pendingRoutes) if (path[0]![0] < hour - 6 * HOUR_MS) ctx.pendingRoutes.delete(tripId);
  }

  const rows = trips.records.map((t) => {
    const start: [number, number] = [t.start_location.lng, t.start_location.lat];
    const end: [number, number] = [t.end_location.lng, t.end_location.lat];
    const path = paths.get(t.trip_id);
    const hasRoute = path !== undefined && path.length >= 2;
    return {
      trip_id: t.trip_id,
      operator_id: op.id,
      device_id: t.device_id,
      vehicle_type: ctx.vehicleTypes.get(t.device_id) ?? "unknown",
      start_time: new Date(t.start_time),
      end_time: new Date(t.end_time),
      billing_month: billingMonth(t.end_time),
      duration_s: t.duration,
      distance_m: t.distance,
      start_lng: start[0],
      start_lat: start[1],
      end_lng: end[0],
      end_lat: end[1],
      start_h3: latLngToCell(start[1], start[0], H3_RESOLUTION),
      end_h3: latLngToCell(end[1], end[0], H3_RESOLUTION),
      touches_equity_zone: ctx.zones.inEquityZone(start) || ctx.zones.inEquityZone(end),
      ends_outside_service_area: !ctx.zones.inServiceArea(end),
      route: hasRoute ? `SRID=4326;LINESTRING(${path.map((p) => `${p[1]} ${p[2]}`).join(",")})` : null,
      max_speed_kph: hasRoute ? Math.round(Math.max(...path.map((p) => p[3] ?? 0)) * 36) / 10 : null,
    };
  });
  await insertRows(ctx.sql, "trips", rows, "on conflict (trip_id) do nothing");
  await insertRows(ctx.sql, "zone_passes", passRows(ctx, op, trips.records, paths), "on conflict (trip_id, zone_id) do nothing");

  await ctx.sql`update operators set ingested_through = ${new Date(hour + HOUR_MS)} where id = ${op.id}`;
  op.ingestedThrough = hour + HOUR_MS;
  return "done";
}

/**
 * What each filed ride did inside the slow zones. The raw points are purged after two days,
 * so the readings the speed rule needs are set aside here, a handful of numbers per ride.
 */
export function passRows(ctx: IngestContext, op: Operator, trips: { trip_id: string; device_id: string }[], paths: Map<string, RoutePoint[]>) {
  if (ctx.zones.slow.length === 0) return [];
  return trips.flatMap((t) =>
    zonePasses(paths.get(t.trip_id) ?? [], ctx.zones.slow).map((pass) => ({
      trip_id: t.trip_id,
      zone_id: pass.zoneId,
      operator_id: op.id,
      device_id: t.device_id,
      entered_at: new Date(pass.enteredAt),
      limit_kph: pass.limitKph,
      speeds: pass.speeds.map((s) => (s === SPEED_GAP ? -1 : Math.round(s * 10))),
    })),
  );
}

export async function purgeTelemetry(ctx: IngestContext, before: number): Promise<void> {
  await ctx.sql`delete from telemetry where ts < ${new Date(before)}`;
}

/** Ingests finished hours in order from where the operator was left off. Stops at the first hour that is not available. */
export async function catchUp(ctx: IngestContext, op: Operator, options: { maxHours: number; routes?: (hour: number) => boolean; keepPoints?: (hour: number) => boolean }): Promise<{ hours: number; last: HourResult }> {
  let hours = 0;
  let last: HourResult = "done";
  while (hours < options.maxHours) {
    const hour = op.ingestedThrough ?? Math.floor(ctx.now() / HOUR_MS) * HOUR_MS - HOUR_MS;
    if (hour + HOUR_MS > ctx.now()) break;
    last = await ingestHour(ctx, op, hour, { routes: options.routes?.(hour) ?? true, keepPoints: options.keepPoints?.(hour) });
    if (last !== "done") break;
    hours++;
  }
  return { hours, last };
}
