// The live picture: who is on the street now, where, and in what state.

import { latLngToCell } from "h3-js";
import { insertRows, type IngestContext, type Operator } from "./context";
import { pollFeed } from "./poll";
import { FEEDS, type FeedId } from "@mm/core";

export const H3_RESOLUTION = 9;

type Location = { lat: number; lng: number; speed?: number };
type MdsEvent = {
  event_id: string;
  device_id: string;
  vehicle_state: string;
  event_types: string[];
  timestamp: number;
  location: Location;
  battery_percent?: number;
  trip_ids?: string[];
};
type MdsTelemetry = { timestamp: number; location: Location; battery_percent?: number; trip_ids?: string[] | null };
type MdsVehicle = { device_id: string; vehicle_id: string; vehicle_type: string; propulsion_types: string[] };
type MdsVehicleStatus = { device_id: string; last_event: MdsEvent; last_telemetry: MdsTelemetry };

/** MDS has several kinds of scooter and bicycle; fees and filters only need the two families. */
export function vehicleFamily(mdsType: string): string {
  if (mdsType.startsWith("scooter")) return "scooter";
  if (mdsType === "bicycle" || mdsType === "cargo_bicycle") return "bicycle";
  return "other";
}

export function eventRow(op: Operator, e: MdsEvent) {
  return {
    event_id: e.event_id,
    operator_id: op.id,
    device_id: e.device_id,
    state: e.vehicle_state,
    event_types: e.event_types,
    ts: new Date(e.timestamp),
    lng: e.location.lng,
    lat: e.location.lat,
    battery: e.battery_percent ?? null,
    trip_id: e.trip_ids?.[0] ?? null,
  };
}

async function pollGbfs(ctx: IngestContext, op: Operator, includeStatic: boolean, store: boolean) {
  const discovery = await pollFeed<{ name: string; url: string }>(ctx, op, "gbfs.gbfs", op.gbfsUrl);
  if (!discovery.usable) return;
  const live = new Set(["vehicle_status", "station_status"]);
  const stations = new Map<string, Record<string, unknown>>();
  let status: Record<string, any>[] = [];
  // The discovery file is one object, not a list of records, so its feed list is read from the body.
  const feeds = ((discovery.body as { data?: { feeds?: { name: string; url: string }[] } } | null)?.data?.feeds ?? []).filter((f) => `gbfs.${f.name}` in FEEDS);
  for (const { name, url } of feeds) {
    if (!includeStatic && !live.has(name)) continue;
    const feed = `gbfs.${name}` as FeedId;
    const poll = await pollFeed<Record<string, any>>(ctx, op, feed, url);
    if (name === "station_information") {
      for (const s of poll.records) {
        stations.set(s.station_id, { station_id: s.station_id, operator_id: op.id, name: s.name?.[0]?.text ?? s.station_id, lng: s.lon, lat: s.lat, capacity: s.capacity ?? null });
      }
    }
    if (name === "station_status" && poll.usable && store) status = poll.records;
  }
  await insertRows(ctx.sql, "stations", [...stations.values()], "on conflict (station_id) do update set name = excluded.name, lng = excluded.lng, lat = excluded.lat, capacity = excluded.capacity");
  if (status.length > 0) {
    await ctx.sql`
      update stations s set vehicles_available = v.available, docks_available = v.docks, updated_at = ${new Date(ctx.now())}
      from unnest(${status.map((x) => String(x.station_id))}::text[], ${status.map((x) => Number(x.num_vehicles_available))}::int[], ${status.map((x) => Number(x.num_docks_available ?? 0))}::int[]) as v(id, available, docks)
      where s.station_id = v.id and s.operator_id = ${op.id}`;
  }
}

/** The operator's list of vehicles. Changes rarely, so it is fetched daily rather than every minute. */
export async function pollRoster(ctx: IngestContext, op: Operator): Promise<void> {
  const poll = await pollFeed<MdsVehicle>(ctx, op, "mds.vehicles", `${op.mdsUrl}/vehicles?page[size]=1000`);
  const seen = new Date(ctx.now());
  const rows = poll.records.map((v) => ({
    device_id: v.device_id,
    operator_id: op.id,
    vehicle_code: v.vehicle_id,
    vehicle_type: vehicleFamily(v.vehicle_type),
    propulsion: v.propulsion_types.join(", "),
    first_seen: seen,
    last_seen: seen,
  }));
  await insertRows(ctx.sql, "vehicles", rows, "on conflict (device_id) do update set vehicle_code = excluded.vehicle_code, vehicle_type = excluded.vehicle_type, propulsion = excluded.propulsion, last_seen = excluded.last_seen");
  for (const r of rows) ctx.vehicleTypes.set(r.device_id, r.vehicle_type);
}

/**
 * Polls every live feed once.
 * `store: false` records the polls (for health history) without touching the live tables.
 */
export async function pollRealtime(ctx: IngestContext, op: Operator, options: { store: boolean; includeStatic: boolean }): Promise<void> {
  await pollGbfs(ctx, op, options.includeStatic, options.store);
  if (options.includeStatic) await pollRoster(ctx, op);

  const status = await pollFeed<MdsVehicleStatus>(ctx, op, "mds.vehicles_status", `${op.mdsUrl}/vehicles/status?page[size]=1000`);
  if (options.store && status.usable) {
    const now = new Date(ctx.now());
    const rows = status.records.map((s) => {
      const at = s.last_telemetry.location;
      return {
        device_id: s.device_id,
        operator_id: op.id,
        state: s.last_event.vehicle_state,
        event_types: s.last_event.event_types,
        event_time: new Date(s.last_event.timestamp),
        lng: at.lng,
        lat: at.lat,
        h3: latLngToCell(at.lat, at.lng, H3_RESOLUTION),
        battery: s.last_telemetry.battery_percent ?? s.last_event.battery_percent ?? null,
        trip_id: s.last_event.vehicle_state === "on_trip" ? (s.last_event.trip_ids?.[0] ?? null) : null,
        updated_at: now,
      };
    });
    await insertRows(
      ctx.sql,
      "vehicle_status",
      rows,
      `on conflict (device_id) do update set state = excluded.state, event_types = excluded.event_types, event_time = excluded.event_time,
        lng = excluded.lng, lat = excluded.lat, h3 = excluded.h3, battery = excluded.battery, trip_id = excluded.trip_id, updated_at = excluded.updated_at`,
    );
  }

  const stops = await ctx.sql`select 1 from stations where operator_id = ${op.id} limit 1`;
  if (stops.length > 0) await pollFeed(ctx, op, "mds.stops", `${op.mdsUrl}/stops`);

  if (options.store) await pollRecentEvents(ctx, op);
}

/** Status changes since the last poll, so the map does not wait for the hourly file. */
async function pollRecentEvents(ctx: IngestContext, op: Operator): Promise<void> {
  const now = ctx.now();
  const from = Math.max(op.eventsThrough ?? op.ingestedThrough ?? now - 3_600_000, now - 13 * 24 * 3_600_000);
  if (now - from < 1000) return;
  const poll = await pollFeed<MdsEvent>(ctx, op, "mds.events_recent", `${op.mdsUrl}/events/recent?start_time=${from}&end_time=${now}&page[size]=1000`);
  if (!poll.usable) return;
  await insertRows(ctx.sql, "status_events", poll.records.map((e) => eventRow(op, e)), "on conflict (event_id) do nothing");
  await ctx.sql`update operators set events_through = ${new Date(now)} where id = ${op.id}`;
  op.eventsThrough = now;
}
