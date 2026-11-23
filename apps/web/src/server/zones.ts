// Policy zones: the shapes the rules are judged against.

import type { Actor } from "@mm/core/access";
import type { Polygon } from "@mm/core/geo";
import type { ZoneType } from "@mm/core/zones";
import { authorize } from "./guard";
import { sql } from "./db";

export type Zone = {
  id: string;
  name: string;
  type: ZoneType;
  speedLimitKph: number | null;
  source: "seed" | "upload" | "drawn";
  effectiveFrom: number;
  retiredAt: number | null;
  createdBy: string | null;
  areaKm2: number;
  shape: GeoJSON.MultiPolygon;
};

export async function zoneList(actor: Actor): Promise<Zone[]> {
  await authorize(actor, "zones.view", { action: "read", resource: "zones" });
  const rows = await sql`select id, name, type, speed_limit_kph, source, effective_from, retired_at, created_by, st_area(geom::geography) / 1e6 as area_km2, st_asgeojson(geom)::json as shape
    from zones order by retired_at desc nulls first, effective_from, name`;
  return rows.map((r) => ({
    id: r.id, name: r.name, type: r.type, speedLimitKph: r.speed_limit_kph, source: r.source, effectiveFrom: r.effective_from.getTime(),
    retiredAt: r.retired_at ? r.retired_at.getTime() : null, createdBy: r.created_by, areaKm2: r.area_km2, shape: r.shape,
  }));
}

export type NewZone = { name: string; type: ZoneType; speedLimitKph: number | null; polygons: Polygon[]; source: "upload" | "drawn" };

/** The smallest zone worth having: about a parking bay. Anything smaller is a slip of the hand. */
const MIN_AREA_M2 = 10;

/** Adopts a zone, in force from now. Returns a sentence when the shape cannot be used. */
export async function createZone(actor: Actor, zone: NewZone): Promise<string | null> {
  await authorize(actor, "zones.change", { action: "change", resource: "zones", detail: { change: "created", name: zone.name, type: zone.type, source: zone.source, ...(zone.speedLimitKph ? { speedLimitKph: zone.speedLimitKph } : {}) } });
  const shape = JSON.stringify({ type: "MultiPolygon", coordinates: zone.polygons });
  const [check] = await sql`select st_isvalid(g) as valid, st_isvalidreason(g) as reason, st_area(g::geography) as area from (select st_setsrid(st_geomfromgeojson(${shape}), 4326) as g) s`;
  if (!check!.valid) return /self-intersection/i.test(check!.reason) ? "The outline crosses itself. Draw the corners in order around the edge, without crossing a line already drawn." : `The shape is not a valid polygon (${String(check!.reason).toLowerCase()}).`;
  if (check!.area < MIN_AREA_M2) return "The shape is too small to be a zone.";
  const slug = `${zone.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "zone"}-${crypto.randomUUID().slice(0, 8)}`;
  await sql`insert into zones (slug, name, type, geom, speed_limit_kph, source, effective_from, created_by)
    values (${slug}, ${zone.name}, ${zone.type}, st_multi(st_setsrid(st_geomfromgeojson(${shape}), 4326)), ${zone.speedLimitKph}, ${zone.source}, now(), ${actor.name})`;
  return null;
}

/** Retires a zone from now. Its shape stays on record, because past findings were judged against it. */
export async function retireZone(actor: Actor, id: string): Promise<string | null> {
  const [zone] = await sql`select id, name, type from zones where id = ${id} and retired_at is null`;
  if (!zone) return "That zone has already been retired.";
  await authorize(actor, "zones.change", { action: "change", resource: "zones", detail: { change: "retired", name: zone.name, type: zone.type } });
  if (zone.type === "service_area") {
    const [others] = await sql`select count(*)::int as n from zones where type = 'service_area' and retired_at is null and id <> ${id}`;
    if (others!.n === 0) return "This is the only service area. Adopt its replacement first, or every parked vehicle would count as outside the permitted area.";
  }
  await sql`update zones set retired_at = now(), retired_by = ${actor.name}, active = false where id = ${id}`;
  return null;
}
