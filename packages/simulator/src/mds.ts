// The operators' MDS 2.1 Provider API, built from the day plans.
// Shapes follow https://github.com/openmobilityfoundation/mobility-data-specification (provider/README.md, data-types.md).

import { feedCondition, withFaults } from "./faults";
import { dayPlan, lastEventBefore, roster, snapshotAt, stations, type DayPlan, type SimEvent, type SimTrip, type SimVehicle } from "./plan";
import { seededUuid } from "./random";
import { addDays, HOUR_MS, serviceDayOf } from "./time";
import { toLngLat, type GridPoint, type OperatorProfile } from "./world";

export const MDS_VERSION = "2.1.0";
const REALTIME_TTL_MS = 60_000;

type Json = Record<string, any>;

export const providerId = (op: OperatorProfile) => seededUuid("provider", op.slug);

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

function gps(at: GridPoint, speed?: number): Json {
  const [lng, lat] = toLngLat(at);
  const point: Json = { lat: round6(lat), lng: round6(lng) };
  if (speed !== undefined) point.speed = Math.round(speed * 100) / 100;
  return point;
}

const MDS_VEHICLE_TYPE = { scooter: "scooter_standing", bicycle: "bicycle" } as const;

/** Service days whose plans can contain anything in [from, to). */
function daysCovering(from: number, to: number): string[] {
  const days: string[] = [];
  const last = serviceDayOf(to);
  for (let d = serviceDayOf(from); d <= last; d = addDays(d, 1)) days.push(d);
  return days;
}

// --- Events ---------------------------------------------------------------------

function eventStateAndTypes(e: SimEvent): [state: string, types: string[]] {
  switch (e.kind) {
    case "deploy":
    case "crew_dropoff":
      return ["available", ["provider_drop_off"]];
    case "trip_start":
      return ["on_trip", ["trip_start"]];
    case "trip_leave_area":
      return ["elsewhere", ["trip_leave_jurisdiction"]];
    case "trip_end":
      return ["available", ["trip_end"]];
    case "battery_low":
      return ["non_operational", ["battery_low"]];
    case "battery_swap":
      return ["available", ["battery_charged"]];
    case "crew_pickup":
      if (e.reason === "rebalance") return ["removed", ["rebalance_pick_up"]];
      if (e.reason === "recover") return ["removed", ["compliance_pick_up"]];
      return ["removed", ["maintenance_pick_up"]];
  }
}

function mdsEvent(op: OperatorProfile, vehicle: SimVehicle, e: SimEvent): Json {
  const [vehicle_state, event_types] = eventStateAndTypes(e);
  const event: Json = {
    device_id: vehicle.deviceId,
    provider_id: providerId(op),
    event_id: e.id,
    vehicle_state,
    event_types,
    timestamp: e.t,
    publication_time: e.t + 2000,
    location: gps(e.at),
    battery_percent: e.battery,
  };
  if (e.tripId) event.trip_ids = [e.tripId];
  return event;
}

export function eventsBetween(seed: string, op: OperatorProfile, from: number, to: number): Json[] {
  const out: Json[] = [];
  for (const date of daysCovering(from, to)) {
    const plan = dayPlan(seed, op, date);
    for (const e of plan.events) {
      if (e.t < from || e.t >= to) continue;
      out.push(withFaults(seed, op, "event", e.id, mdsEvent(op, plan.vehicles[e.vehicle]!, e)));
    }
  }
  return out;
}

// --- Telemetry ------------------------------------------------------------------

function tripTelemetry(op: OperatorProfile, plan: DayPlan, trip: SimTrip, index: number): Json {
  const p = trip.route[index]!;
  const progress = (p.t - trip.startT) / Math.max(1, trip.endT - trip.startT);
  return {
    device_id: plan.vehicles[trip.vehicle]!.deviceId,
    provider_id: providerId(op),
    telemetry_id: seededUuid(trip.id, "telemetry", index),
    timestamp: p.t,
    trip_ids: [trip.id],
    journey_id: null,
    location: gps(p, p.speed),
    battery_percent: Math.round(trip.startBattery + (trip.endBattery - trip.startBattery) * progress),
  };
}

function eventTelemetry(op: OperatorProfile, vehicle: SimVehicle, e: SimEvent): Json {
  return {
    device_id: vehicle.deviceId,
    provider_id: providerId(op),
    telemetry_id: seededUuid(e.id, "telemetry"),
    timestamp: e.t,
    trip_ids: null,
    journey_id: null,
    location: gps(e.at, 0),
    battery_percent: e.battery,
  };
}

const isTripEvent = (e: SimEvent) => e.kind === "trip_start" || e.kind === "trip_end" || e.kind === "trip_leave_area";

export function telemetryBetween(seed: string, op: OperatorProfile, from: number, to: number): Json[] {
  const out: Json[] = [];
  for (const date of daysCovering(from, to)) {
    const plan = dayPlan(seed, op, date);
    for (const trip of plan.trips) {
      if (trip.endT < from || trip.startT >= to) continue;
      trip.route.forEach((p, i) => {
        if (p.t < from || p.t >= to) return;
        const record = tripTelemetry(op, plan, trip, i);
        out.push(withFaults(seed, op, "telemetry", record.telemetry_id, record));
      });
    }
    for (const e of plan.events) {
      if (e.t < from || e.t >= to || isTripEvent(e)) continue;
      const record = eventTelemetry(op, plan.vehicles[e.vehicle]!, e);
      out.push(withFaults(seed, op, "telemetry", record.telemetry_id, record));
    }
  }
  return out.sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
}

// --- Trips ----------------------------------------------------------------------

/** What the rider paid, in cents: $1 to unlock and 39 cents a minute. */
const fareCents = (durationSeconds: number) => 100 + 39 * Math.ceil(durationSeconds / 60);

function mdsTrip(op: OperatorProfile, plan: DayPlan, trip: SimTrip): Json {
  const first = trip.route[0]!;
  const last = trip.route[trip.route.length - 1]!;
  const duration = Math.round((trip.endT - trip.startT) / 1000);
  return {
    provider_id: providerId(op),
    device_id: plan.vehicles[trip.vehicle]!.deviceId,
    trip_id: trip.id,
    trip_type: "rider",
    start_time: trip.startT,
    end_time: trip.endT,
    start_location: gps(first),
    end_location: gps(last),
    duration,
    distance: Math.round(trip.distanceM),
    publication_time: trip.endT + 5000,
    standard_cost: fareCents(duration),
    actual_cost: fareCents(duration),
    currency: "USD",
  };
}

/** Trips that ended in [from, to). */
export function tripsEndedBetween(seed: string, op: OperatorProfile, from: number, to: number): Json[] {
  const out: Json[] = [];
  // A trip belongs to the service day it started in, which can be the day before it ended.
  for (const date of daysCovering(from - 3 * HOUR_MS, to)) {
    const plan = dayPlan(seed, op, date);
    for (const trip of plan.trips) {
      if (trip.endT < from || trip.endT >= to) continue;
      out.push(withFaults(seed, op, "trip", trip.id, mdsTrip(op, plan, trip)));
    }
  }
  return out;
}

/** True trip count for a service day, for the operator's own monthly report. */
export function tripCountOn(seed: string, op: OperatorProfile, date: string): { scooter: number; bicycle: number } {
  const plan = dayPlan(seed, op, date);
  const count = { scooter: 0, bicycle: 0 };
  for (const trip of plan.trips) count[plan.vehicles[trip.vehicle]!.kind]++;
  return count;
}

// --- Vehicles -------------------------------------------------------------------

const MODELS = {
  kestrel: { scooter: ["Kestrel", "K3 Glide"], bicycle: ["Kestrel", "Tailwind E"] },
  pronghorn: { scooter: ["Pronghorn", "Dash 2"], bicycle: ["Pronghorn", "Dash Bike"] },
  saltgrass: { scooter: ["Saltgrass", "Brine S"], bicycle: ["Saltgrass", "Shoreline E"] },
} as Record<string, Record<"scooter" | "bicycle", [string, string]>>;

export function vehicles(seed: string, op: OperatorProfile): Json[] {
  return roster(seed, op).map((v) => {
    const [make, model] = MODELS[op.slug]?.[v.kind] ?? [op.name, v.kind];
    return withFaults(seed, op, "vehicle", v.deviceId, {
      device_id: v.deviceId,
      provider_id: providerId(op),
      vehicle_id: v.code,
      vehicle_type: MDS_VEHICLE_TYPE[v.kind],
      vehicle_attributes: { year: 2025 + (v.index % 2), make, model },
      propulsion_types: [v.kind === "scooter" ? "electric" : "electric_assist"],
      battery_capacity: v.kind === "scooter" ? 551 : 630,
      maximum_speed: v.kind === "scooter" ? 24 : 32,
    });
  });
}

export function vehiclesStatus(seed: string, op: OperatorProfile, t: number): Json[] {
  const plan = dayPlan(seed, op, serviceDayOf(t));
  const out: Json[] = [];
  for (const snap of snapshotAt(plan, t)) {
    const e = snap.lastEvent ?? lastEventBefore(seed, op, snap.vehicle.index, t);
    if (!e) continue; // never been on the street
    const last_event = withFaults(seed, op, "event", e.id, mdsEvent(op, snap.vehicle, e));
    let last_telemetry: Json;
    const trip = e.tripId ? plan.tripsById.get(e.tripId) : undefined;
    if (trip && (e.kind === "trip_start" || e.kind === "trip_leave_area")) {
      let index = 0;
      while (index + 1 < trip.route.length && trip.route[index + 1]!.t <= t) index++;
      last_telemetry = tripTelemetry(op, plan, trip, index);
      if (index === trip.route.length - 1) last_telemetry.trip_ids = null; // ride is over
    } else {
      last_telemetry = eventTelemetry(op, snap.vehicle, e);
    }
    out.push({ device_id: snap.vehicle.deviceId, provider_id: providerId(op), last_event, last_telemetry });
  }
  return out;
}

// --- Stops ----------------------------------------------------------------------

export function stops(seed: string, op: OperatorProfile, t: number): Json[] {
  const docks = stations(seed, op);
  if (docks.length === 0) return [];
  const plan = dayPlan(seed, op, serviceDayOf(t));
  const parked = new Map<string, { available: number; disabled: number; devices: string[] }>();
  for (const snap of snapshotAt(plan, t)) {
    if (!snap.vehicle.docked || (snap.state !== "available" && snap.state !== "non_operational")) continue;
    const dock = docks.find((d) => Math.abs(d.at.x - snap.at.x) < 1e-6 && Math.abs(d.at.y - snap.at.y) < 1e-6);
    if (!dock) continue;
    const entry = parked.get(dock.id) ?? { available: 0, disabled: 0, devices: [] };
    if (snap.state === "available") entry.available++;
    else entry.disabled++;
    entry.devices.push(snap.vehicle.deviceId);
    parked.set(dock.id, entry);
  }
  return docks.map((d) => {
    const here = parked.get(d.id) ?? { available: 0, disabled: 0, devices: [] };
    return {
      stop_id: d.id,
      name: d.name,
      last_updated: t,
      location: gps(d.at),
      status: { is_installed: true, is_renting: true, is_returning: true },
      capacity: { bicycle: d.capacity },
      num_vehicles_available: { bicycle: here.available },
      num_vehicles_disabled: { bicycle: here.disabled },
      num_places_available: { bicycle: Math.max(0, d.capacity - here.available - here.disabled) },
      devices: here.devices,
    };
  });
}

/** The instant the realtime feeds describe: now, or earlier if the feed is stuck. */
export function realtimeInstant(seed: string, op: OperatorProfile, now: number): number {
  return feedCondition(seed, op, now).frozenAt ?? now;
}

export const realtimeEnvelope = (t: number) => ({ version: MDS_VERSION, last_updated: t, ttl: REALTIME_TTL_MS });
