// Policy zones: the kinds the city can draw, and the checks an uploaded
// GeoJSON file must pass before it is allowed anywhere near the rules.

import { CITY_BOUNDS } from "./city";
import type { LngLat, Polygon } from "./geo";

export const ZONE_TYPES = ["service_area", "no_ride", "slow_ride", "no_parking", "required_parking", "equity"] as const;
export type ZoneType = (typeof ZONE_TYPES)[number];

export const ZONE_LABELS: Record<ZoneType, string> = {
  service_area: "Service area",
  no_ride: "No-ride zone",
  slow_ride: "Slow-ride zone",
  no_parking: "No-parking zone",
  required_parking: "Required parking",
  equity: "Equity zone",
};

/** What each kind of zone does once it is adopted, in the words shown to staff. */
export const ZONE_EFFECTS: Record<ZoneType, string> = {
  service_area: "Vehicles may operate here. A vehicle left outside every service area counts against the rebalancing deadline.",
  no_ride: "Vehicles may not be ridden or left here. A vehicle left here counts against the rebalancing deadline.",
  slow_ride: "Rides through here are checked against the zone's speed limit.",
  no_parking: "Vehicles may pass through but not be left here. A vehicle left here counts against the rebalancing deadline.",
  required_parking: "Marks where vehicles are meant to be parked. Shown on the map; no rule checks it yet.",
  equity: "Counts toward the equity minimum. Rides that start here can be exempt from the per-ride fee.",
};

export const SLOW_ZONE_LIMITS = { min: 5, max: 25 };
export const ZONE_NAME_MAX = 60;

const MAX_FILE_BYTES = 200_000;
const MAX_POLYGONS = 50;
const MAX_VERTICES = 2_000;

export type ParsedZone = { ok: true; polygons: Polygon[]; name: string | null; vertices: number } | { ok: false; problem: string };

const fail = (problem: string): ParsedZone => ({ ok: false, problem });

/**
 * Reads a GeoJSON file into polygons. Accepts a Polygon, MultiPolygon, Feature or
 * FeatureCollection; anything else in a collection (points, lines) is a refusal, not
 * a silent skip, so the person uploading knows the file was not what they thought.
 */
export function parseZoneGeoJson(text: string): ParsedZone {
  if (text.length > MAX_FILE_BYTES) return fail(`The file is larger than ${MAX_FILE_BYTES / 1000} KB. Simplify the shape and try again.`);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return fail("The file is not valid JSON.");
  }
  if (!isRecord(json)) return fail("The file is not a GeoJSON object.");

  const geometries: unknown[] = [];
  let name: string | null = null;
  const takeFeature = (feature: Record<string, unknown>) => {
    geometries.push(feature.geometry);
    const props = feature.properties;
    if (name === null && isRecord(props) && typeof props.name === "string" && props.name.trim()) name = props.name.trim().slice(0, ZONE_NAME_MAX);
  };

  if (json.type === "FeatureCollection") {
    if (!Array.isArray(json.features) || json.features.length === 0) return fail("The feature collection is empty.");
    for (const feature of json.features) {
      if (!isRecord(feature) || feature.type !== "Feature") return fail("The feature collection contains something that is not a feature.");
      takeFeature(feature);
    }
  } else if (json.type === "Feature") takeFeature(json);
  else if (json.type === "Polygon" || json.type === "MultiPolygon") geometries.push(json);
  else return fail(`Expected a Polygon, MultiPolygon, Feature or FeatureCollection, but the file's type is ${describe(json.type)}.`);

  const polygons: Polygon[] = [];
  for (const geometry of geometries) {
    if (!isRecord(geometry)) return fail("A feature has no geometry.");
    if (geometry.type === "Polygon") polygons.push(geometry.coordinates as Polygon);
    else if (geometry.type === "MultiPolygon" && Array.isArray(geometry.coordinates)) polygons.push(...(geometry.coordinates as Polygon[]));
    else return fail(`Zones must be polygons, but the file contains a ${describe(geometry.type)}.`);
  }
  if (polygons.length === 0) return fail("The file contains no polygons.");
  if (polygons.length > MAX_POLYGONS) return fail(`The file contains ${polygons.length} polygons; the limit is ${MAX_POLYGONS}.`);

  const [west, south, east, north] = CITY_BOUNDS;
  const cleaned: Polygon[] = [];
  let vertices = 0;
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || polygon.length === 0) return fail("A polygon has no rings.");
    const rings: LngLat[][] = [];
    for (const ring of polygon) {
      if (!Array.isArray(ring)) return fail("A polygon ring is not a list of positions.");
      const points: LngLat[] = [];
      for (const position of ring) {
        if (!Array.isArray(position) || position.length < 2 || !Number.isFinite(position[0]) || !Number.isFinite(position[1]) || typeof position[0] !== "number" || typeof position[1] !== "number") {
          return fail("A position is not a pair of numbers.");
        }
        const [lng, lat] = position as [number, number];
        if (lng < west || lng > east || lat < south || lat > north) {
          const swapped = lat >= west && lat <= east && lng >= south && lng <= north;
          return fail(
            swapped
              ? `The position [${lng}, ${lat}] looks like latitude then longitude. GeoJSON puts longitude first.`
              : `The position [${lng}, ${lat}] is outside the area this console covers. Zones must be in WGS84 longitude and latitude (EPSG:4326), longitude first.`,
          );
        }
        points.push([lng, lat]);
      }
      const first = points[0];
      const last = points[points.length - 1];
      if (first && last && (first[0] !== last[0] || first[1] !== last[1])) points.push([first[0], first[1]]);
      if (points.length < 4) return fail("A polygon ring needs at least three distinct corners.");
      vertices += points.length;
      if (vertices > MAX_VERTICES) return fail(`The shape has more than ${MAX_VERTICES} corners. Simplify it and try again.`);
      rings.push(points);
    }
    if (ringArea(rings[0]!) === 0) return fail("A polygon has no area.");
    cleaned.push(rings);
  }
  return { ok: true, polygons: cleaned, name, vertices };
}

/** Twice the signed area in square degrees: only ever compared with zero. */
function ringArea(ring: LngLat[]): number {
  let sum = 0;
  for (let i = 1; i < ring.length; i++) sum += ring[i - 1]![0] * ring[i]![1] - ring[i]![0] * ring[i - 1]![1];
  return sum;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const describe = (type: unknown) => (typeof type === "string" ? type : "missing type");
