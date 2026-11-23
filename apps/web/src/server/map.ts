// What the live map reads. Operator-portal users only ever get their own fleet.

import type { Actor } from "@mm/core/access";
import { authorize } from "./guard";
import { sql, sqlNow } from "./db";

const scoped = (column: string, operatorId: string | null) => (operatorId ? sql`${sql(column)} = ${operatorId}` : sql`true`);

export type LiveVehicle = {
  id: string;
  code: string;
  operator: string;
  type: string;
  state: string;
  lng: number;
  lat: number;
  h3: string;
  battery: number | null;
  since: number;
};

export async function liveMap(actor: Actor) {
  const scope = await authorize(actor, "map.view", { action: "read", resource: "live_map", repeating: true });
  const [vehicles, stations, operators, zones] = await Promise.all([
    sql`select s.device_id as id, v.vehicle_code as code, o.slug as operator, v.vehicle_type as type, s.state, s.lng, s.lat, s.h3, s.battery, s.event_time, s.updated_at
      from vehicle_status s join vehicles v using (device_id) join operators o on o.id = s.operator_id where ${scoped("s.operator_id", scope)}`,
    sql`select s.station_id as id, s.name, o.slug as operator, s.lng, s.lat, s.capacity, s.vehicles_available as available
      from stations s join operators o on o.id = s.operator_id where ${scoped("s.operator_id", scope)}`,
    sql`select slug, name from operators o where ${scoped("o.id", scope)} order by name`,
    sql`select slug, name, type, speed_limit_kph, st_asgeojson(geom)::json as shape from zones where active`,
  ]);
  const asOf = vehicles.reduce((latest, v) => Math.max(latest, v.updated_at.getTime()), 0);
  return {
    asOf,
    operators: operators.map((o) => ({ slug: o.slug as string, name: o.name as string })),
    vehicles: vehicles.map((v): LiveVehicle => ({ id: v.id, code: v.code, operator: v.operator, type: v.type, state: v.state, lng: v.lng, lat: v.lat, h3: v.h3, battery: v.battery, since: v.event_time.getTime() })),
    stations: stations.map((s) => ({ id: s.id as string, name: s.name as string, operator: s.operator as string, lng: s.lng as number, lat: s.lat as number, capacity: s.capacity as number | null, available: s.available as number | null })),
    zones: {
      type: "FeatureCollection" as const,
      features: zones.map((z) => ({ type: "Feature" as const, geometry: z.shape, properties: { slug: z.slug, name: z.name, type: z.type, speedLimitKph: z.speed_limit_kph } })),
    },
  };
}

/** Trip starts or ends per hexagon (about a city block across) over the last `days` days. */
export async function tripHexes(actor: Actor, options: { end: "origins" | "destinations"; days: number; operators: string[] | null; type: string | null }) {
  const days = Math.min(Math.max(1, Math.round(options.days)), 31);
  const scope = await authorize(actor, "map.view", { action: "read", resource: "trip_heatmap", detail: { ...options, days } });
  const column = options.end === "origins" ? "start_h3" : "end_h3";
  const rows = await sql`
    select ${sql(column)} as h3, count(*)::int as n
    from trips t join operators o on o.id = t.operator_id
    where t.end_time > ${sqlNow()} - make_interval(days => ${days}) and ${scoped("t.operator_id", scope)}
      and ${options.operators ? sql`o.slug = any(${options.operators})` : sql`true`} and ${options.type ? sql`t.vehicle_type = ${options.type}` : sql`true`}
    group by 1`;
  return { days, cells: rows.map((r) => [r.h3 as string, r.n as number] as const) };
}

/**
 * Everything needed to replay the last day in the browser: where each vehicle
 * stood when the window opened, and each status change since.
 */
export async function playback(actor: Actor) {
  const scope = await authorize(actor, "map.view", { action: "read", resource: "map_playback", detail: { hours: 24 } });
  const [latest] = await sql`select max(ts) as ts from status_events where ${scoped("operator_id", scope)}`;
  if (!latest?.ts) return { start: 0, end: 0, vehicles: [], events: [] };
  const end = latest.ts.getTime();
  const start = end - 24 * 3_600_000;
  const vehicles = await sql`
    select v.device_id, v.vehicle_code, o.slug, v.vehicle_type, e.state, e.lng, e.lat, e.battery
    from vehicles v join operators o on o.id = v.operator_id
    left join lateral (select state, lng, lat, battery from status_events e where e.device_id = v.device_id and e.ts <= ${new Date(start)} order by e.ts desc limit 1) e on true
    where ${scoped("v.operator_id", scope)}`;
  const index = new Map(vehicles.map((v, i) => [v.device_id as string, i]));
  const events = await sql`select device_id, ts, state, lng, lat, battery from status_events
    where ts > ${new Date(start)} and ts <= ${new Date(end)} and ${scoped("operator_id", scope)} order by ts`;
  return {
    start,
    end,
    vehicles: vehicles.map((v) => ({ id: v.device_id as string, code: v.vehicle_code as string, operator: v.slug as string, type: v.vehicle_type as string, state: (v.state ?? "removed") as string, lng: v.lng as number | null, lat: v.lat as number | null, battery: v.battery as number | null })),
    // [vehicle index, seconds after the window opened, state, lng, lat, battery]
    events: events.filter((e) => index.has(e.device_id)).map((e) => [index.get(e.device_id)!, Math.round((e.ts.getTime() - start) / 1000), e.state as string, e.lng as number, e.lat as number, e.battery as number | null] as const),
  };
}
