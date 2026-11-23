// The operators' public GBFS 3.0 feeds, built from the same day plans as MDS.
// Shapes follow https://github.com/MobilityData/gbfs/blob/v3.0/gbfs.md

import { withFaults } from "./faults";
import { dayPlan, snapshotAt, stations, type VehicleSnapshot } from "./plan";
import { seededUuid } from "./random";
import { serviceDayOf, TIME_ZONE } from "./time";
import { toLngLat, ZONES, type OperatorProfile, type Zone } from "./world";

export const GBFS_VERSION = "3.0";
export const GBFS_FEEDS = ["system_information", "vehicle_types", "vehicle_status", "station_information", "station_status", "geofencing_zones"] as const;
export type GbfsFeed = (typeof GBFS_FEEDS)[number];

type Json = Record<string, any>;

const text = (value: string) => [{ text: value, language: "en" }];
const iso = (t: number) => new Date(Math.floor(t / 1000) * 1000).toISOString().replace(".000Z", "Z");
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

const RANGE_METERS = { scooter: 32_000, bicycle: 56_000 } as const;
const typeId = (op: OperatorProfile, kind: "scooter" | "bicycle") => `${op.slug}-${kind === "scooter" ? "scooter" : "ebike"}`;

export function feedsFor(op: OperatorProfile): GbfsFeed[] {
  return GBFS_FEEDS.filter((f) => op.stations > 0 || (f !== "station_information" && f !== "station_status"));
}

function envelope(t: number, ttl: number, data: Json): Json {
  return { last_updated: iso(t), ttl, version: GBFS_VERSION, data };
}

export function discovery(op: OperatorProfile, t: number, baseUrl: string): Json {
  return envelope(t, 3600, {
    feeds: feedsFor(op).map((name) => ({ name, url: `${baseUrl}/${name}.json` })),
  });
}

function systemInformation(op: OperatorProfile): Json {
  return {
    system_id: `${op.slug}-slc-demo`,
    languages: ["en"],
    name: text(`${op.name} (simulated)`),
    operator: text(`${op.name}, a fictional operator in a demonstration`),
    opening_hours: "Mo-Su 05:00-02:00",
    feed_contact_email: `feeds@${op.slug}.example`,
    timezone: TIME_ZONE,
    license_url: "https://creativecommons.org/publicdomain/zero/1.0/",
  };
}

function vehicleTypes(op: OperatorProfile): Json {
  const types: Json[] = [];
  if (op.scooters > 0) {
    types.push({
      vehicle_type_id: typeId(op, "scooter"),
      form_factor: "scooter_standing",
      propulsion_type: "electric",
      max_range_meters: RANGE_METERS.scooter,
      name: text("E-scooter"),
    });
  }
  if (op.bikes > 0) {
    types.push({
      vehicle_type_id: typeId(op, "bicycle"),
      form_factor: "bicycle",
      propulsion_type: "electric_assist",
      max_range_meters: RANGE_METERS.bicycle,
      name: text("E-bike"),
    });
  }
  return { vehicle_types: types };
}

const rentable = (s: VehicleSnapshot) => s.state === "available" || s.state === "non_operational";

function vehicleStatus(seed: string, op: OperatorProfile, t: number): Json {
  const plan = dayPlan(seed, op, serviceDayOf(t));
  const docks = stations(seed, op);
  const list: Json[] = [];
  for (const s of snapshotAt(plan, t)) {
    // GBFS lists only vehicles a member of the public could walk up to.
    if (!rentable(s)) continue;
    // The public id changes after every rental, so riders cannot be followed between trips.
    const vehicle_id = seededUuid("gbfs", s.vehicle.deviceId, s.lastEvent?.id ?? plan.date);
    const record: Json = {
      vehicle_id,
      is_reserved: false,
      is_disabled: s.state === "non_operational",
      vehicle_type_id: typeId(op, s.vehicle.kind),
      last_reported: iso(t),
      current_range_meters: Math.round((RANGE_METERS[s.vehicle.kind] * s.battery) / 100),
      current_fuel_percent: s.battery / 100,
    };
    const dock = s.vehicle.docked ? docks.find((d) => Math.abs(d.at.x - s.at.x) < 1e-6 && Math.abs(d.at.y - s.at.y) < 1e-6) : undefined;
    if (dock) {
      record.station_id = dock.id;
    } else {
      const [lng, lat] = toLngLat(s.at);
      record.lat = round6(lat);
      record.lon = round6(lng);
    }
    list.push(withFaults(seed, op, "gbfs_vehicle", vehicle_id, record));
  }
  return { vehicles: list };
}

function stationInformation(seed: string, op: OperatorProfile): Json {
  return {
    stations: stations(seed, op).map((d) => {
      const [lng, lat] = toLngLat(d.at);
      return { station_id: d.id, name: text(d.name), lat: round6(lat), lon: round6(lng), capacity: d.capacity };
    }),
  };
}

function stationStatus(seed: string, op: OperatorProfile, t: number): Json {
  const plan = dayPlan(seed, op, serviceDayOf(t));
  const docks = stations(seed, op);
  const snaps = snapshotAt(plan, t).filter((s) => s.vehicle.docked && rentable(s));
  return {
    stations: docks.map((d) => {
      const here = snaps.filter((s) => Math.abs(d.at.x - s.at.x) < 1e-6 && Math.abs(d.at.y - s.at.y) < 1e-6);
      const available = here.filter((s) => s.state === "available").length;
      return {
        station_id: d.id,
        num_vehicles_available: available,
        num_vehicles_disabled: here.length - available,
        num_docks_available: Math.max(0, d.capacity - here.length),
        is_installed: true,
        is_renting: true,
        is_returning: true,
        last_reported: iso(t),
      };
    }),
  };
}

function zoneRule(z: Zone): Json | null {
  switch (z.type) {
    case "no_ride":
      return { ride_start_allowed: false, ride_end_allowed: false, ride_through_allowed: false };
    case "slow_ride":
      return { ride_start_allowed: true, ride_end_allowed: true, ride_through_allowed: true, maximum_speed_kph: z.speedLimitKph ?? 13 };
    case "no_parking":
      return { ride_start_allowed: true, ride_end_allowed: false, ride_through_allowed: true };
    case "service_area":
      return { ride_start_allowed: true, ride_end_allowed: true, ride_through_allowed: true };
    default:
      return null; // equity zones are city policy, not a riding rule
  }
}

function geofencingZones(): Json {
  const features: Json[] = [];
  // Most specific zones first: GBFS applies the first matching rule.
  for (const z of [...ZONES].sort((a, b) => Number(a.type === "service_area") - Number(b.type === "service_area"))) {
    const rule = zoneRule(z);
    if (!rule) continue;
    features.push({
      type: "Feature",
      properties: { name: text(z.name), rules: [rule] },
      geometry: { type: "MultiPolygon", coordinates: [z.polygon.map((ring) => ring.map(([lng, lat]) => [round6(lng), round6(lat)]))] },
    });
  }
  return {
    geofencing_zones: { type: "FeatureCollection", features },
    // Outside every listed zone, riding and parking are not permitted.
    global_rules: [{ ride_start_allowed: false, ride_end_allowed: false, ride_through_allowed: true }],
  };
}

export function gbfsFeed(seed: string, op: OperatorProfile, feed: GbfsFeed, t: number): Json {
  switch (feed) {
    case "system_information":
      return envelope(t, 86_400, systemInformation(op));
    case "vehicle_types":
      return envelope(t, 86_400, vehicleTypes(op));
    case "vehicle_status":
      return envelope(t, 60, vehicleStatus(seed, op, t));
    case "station_information":
      return envelope(t, 86_400, stationInformation(seed, op));
    case "station_status":
      return envelope(t, 60, stationStatus(seed, op, t));
    case "geofencing_zones":
      return envelope(t, 86_400, geofencingZones());
  }
}
