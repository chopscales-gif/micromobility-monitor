import { pointInPolygon, type LngLat, type Polygon, type RoutePoint, type RuleZone } from "@mm/core";
import { decryptToken, type Sql } from "@mm/db";

export type FetchResult = {
  /** HTTP status, or 0 when no answer arrived at all. */
  status: number;
  body: string;
  latencyMs: number;
};

/** How feeds are fetched: over HTTP normally, or straight from the simulator when seeding. */
export type FeedFetcher = (url: string, headers: Record<string, string>) => Promise<FetchResult>;

export type IngestContext = {
  sql: Sql;
  fetch: FeedFetcher;
  /** The current time. Seeding replays history by moving this clock forward. */
  now: () => number;
  zones: ZoneIndex;
  vehicleTypes: Map<string, string>;
  /** Location points of rides still in progress, by trip id. */
  pendingRoutes: Map<string, RoutePoint[]>;
  log: (message: string) => void;
};

export type { RoutePoint };

export type Operator = {
  id: string;
  slug: string;
  name: string;
  gbfsUrl: string;
  mdsUrl: string;
  token: string;
  ingestedThrough: number | null;
  eventsThrough: number | null;
};

export const httpFetcher: FeedFetcher = async (url, headers) => {
  const started = performance.now();
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
    const body = await response.text();
    return { status: response.status, body, latencyMs: Math.round(performance.now() - started) };
  } catch {
    return { status: 0, body: "", latencyMs: Math.round(performance.now() - started) };
  }
};

export async function loadOperators(sql: Sql): Promise<Operator[]> {
  const rows = await sql`select id, slug, name, gbfs_url, mds_url, mds_token_encrypted, ingested_through, events_through from operators order by name`;
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    gbfsUrl: r.gbfs_url,
    mdsUrl: r.mds_url,
    token: decryptToken(r.mds_token_encrypted),
    ingestedThrough: r.ingested_through ? r.ingested_through.getTime() : null,
    eventsThrough: r.events_through ? r.events_through.getTime() : null,
  }));
}

/** The city's zones, held in memory so each trip can be tested against them as it arrives. */
export type ZoneIndex = {
  inServiceArea: (p: LngLat) => boolean;
  inEquityZone: (p: LngLat) => boolean;
  /** Slow-ride zones, past and present: each ride is tested against the ones in force when it happened. */
  slow: RuleZone[];
};

/** Every zone the city has adopted, including retired ones, in the form the rules read. */
export async function loadRuleZones(sql: Sql): Promise<RuleZone[]> {
  const rows = await sql`select id, name, type, speed_limit_kph, effective_from, retired_at, st_asgeojson(geom)::json as shape from zones order by created_at, name`;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    polygons: r.shape.coordinates as Polygon[],
    speedLimitKph: r.speed_limit_kph,
    effectiveFrom: r.effective_from.getTime(),
    retiredAt: r.retired_at ? r.retired_at.getTime() : null,
  }));
}

export async function loadZones(sql: Sql): Promise<ZoneIndex> {
  const rows = await sql`select type, st_asgeojson(geom)::json as shape from zones where active and type in ('service_area', 'equity')`;
  const slow = (await loadRuleZones(sql)).filter((z) => z.type === "slow_ride");
  const polygons = (type: string): Polygon[] => rows.filter((r) => r.type === type).flatMap((r) => r.shape.coordinates as Polygon[]);
  const service = polygons("service_area");
  const equity = polygons("equity");
  const within = (list: Polygon[]) => (p: LngLat) => list.some((polygon) => pointInPolygon(p, polygon));
  return {
    // With no service area drawn, nothing can be outside it.
    inServiceArea: service.length === 0 ? () => true : within(service),
    inEquityZone: within(equity),
    slow,
  };
}

export async function createContext(sql: Sql, fetch: FeedFetcher, now: () => number = Date.now): Promise<IngestContext> {
  const types = await sql`select device_id, vehicle_type from vehicles`;
  return {
    sql,
    fetch,
    now,
    zones: await loadZones(sql),
    vehicleTypes: new Map(types.map((r) => [r.device_id, r.vehicle_type])),
    pendingRoutes: new Map(),
    log: (message) => console.log(message),
  };
}

/** Multi-row insert, split so no statement exceeds the driver's parameter limit. */
export async function insertRows(sql: Sql, table: string, rows: Record<string, unknown>[], onConflict: string): Promise<void> {
  if (rows.length === 0) return;
  const columns = Object.keys(rows[0]!);
  const size = Math.floor(60_000 / columns.length);
  for (let i = 0; i < rows.length; i += size) {
    await sql`insert into ${sql(table)} ${sql(rows.slice(i, i + size) as never, ...(columns as never[]))} ${sql.unsafe(onConflict)}`;
  }
}
