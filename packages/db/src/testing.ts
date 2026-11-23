// A scratch database for the tests that need real SQL: the report, the public figures, the monthly
// email and the route purge. It lives beside the demo's own database, on the same server, under a
// name ending in "_test", and is emptied by each test file that uses it. The demo's data is never touched.

import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import type { Sql } from "./index";

/** The server the scratch databases are made on. The default is the demo's own PostGIS container (docker-compose.yml). */
const SERVER = process.env.TEST_DATABASE_SERVER ?? "postgres://mm:mm@localhost:54329";

export type TestDatabase = { sql: Sql; url: string; close: () => Promise<void> };

/**
 * Makes (or reuses) the scratch database `mm_<name>_test`, brings its tables up to date and empties them.
 * Returns null when no database server answers, so the suite can say those tests were skipped rather than fail.
 * Each test file takes its own name: files run side by side and must not empty one another's tables.
 */
export async function testDatabase(name: string): Promise<TestDatabase | null> {
  if (!/^[a-z_]+$/.test(name)) throw new Error("A test database name is lower-case letters and underscores");
  const database = `mm_${name}_test`;
  const admin = postgres(`${SERVER}/postgres`, { max: 1, onnotice: () => {}, connect_timeout: 3 });
  try {
    const [found] = await admin`select 1 from pg_database where datname = ${database}`;
    if (!found) await admin.unsafe(`create database ${database}`);
  } catch {
    return null;
  } finally {
    await admin.end();
  }
  const url = `${SERVER}/${database}`;
  // Migrations go through a connection of their own: Drizzle changes how the connection it is given handles dates.
  const setup = postgres(url, { max: 1, onnotice: () => {} });
  await setup`create extension if not exists postgis`;
  await migrate(drizzle(setup), { migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url)) });
  await setup.end();
  const sql = postgres(url, { max: 4, onnotice: () => {} });
  await empty(sql);
  return { sql, url, close: () => sql.end() };
}

/** Empties every table of the scratch database. Refuses anything not named as one. */
export async function empty(sql: Sql): Promise<void> {
  const [{ name }] = (await sql`select current_database() as name`) as unknown as [{ name: string }];
  if (!name.endsWith("_test")) throw new Error(`Refusing to empty "${name}": not a test database`);
  const tables = await sql`select tablename from pg_tables where schemaname = 'public' and tablename <> 'spatial_ref_sys'`;
  if (tables.length > 0) await sql.unsafe(`truncate ${tables.map((t) => `"${t.tablename}"`).join(", ")} restart identity cascade`);
}

const DAY = 86_400_000;
let serial = 0;
/** A fixed, readable uuid: the same call order gives the same ids. */
export const fixedId = () => `00000000-0000-4000-8000-${String(++serial).padStart(12, "0")}`;

export async function addOperator(sql: Sql, slug: string, name: string): Promise<string> {
  const [row] = await sql`insert into operators ${sql({ slug, name, provider_id: fixedId(), gbfs_url: `http://feeds.invalid/${slug}/gbfs`, mds_url: `http://feeds.invalid/${slug}/mds`, mds_token_encrypted: "not-a-token" })} returning id`;
  return row!.id as string;
}

export async function addUser(sql: Sql, name: string, role: string, operatorId: string | null = null): Promise<{ userId: string; name: string; role: string; operatorId: string | null }> {
  const [row] = await sql`insert into users ${sql({ name, email: `${name.toLowerCase().replace(/\W+/g, ".")}@example.invalid`, title: role, role, operator_id: operatorId })} returning id`;
  return { userId: row!.id as string, name, role, operatorId };
}

export async function addVehicles(sql: Sql, operatorId: string, type: string, howMany: number, seen: { first: number; last: number }): Promise<string[]> {
  const rows = Array.from({ length: howMany }, () => ({ device_id: fixedId(), operator_id: operatorId, vehicle_code: `V${serial}`, vehicle_type: type, propulsion: "electric", first_seen: new Date(seen.first), last_seen: new Date(seen.last) }));
  if (rows.length > 0) await sql`insert into vehicles ${sql(rows)}`;
  return rows.map((r) => r.device_id);
}

export type TestTrip = {
  operatorId: string;
  type?: string;
  /** When the ride ended. */
  end: number;
  month: string;
  durationS?: number;
  distanceM?: number;
  startH3?: string;
  endH3?: string;
  equity?: boolean;
  /** Give the ride a stored route. */
  route?: boolean;
  deviceId?: string;
};

/** Inserts rides and returns their ids, in order. */
export async function addTrips(sql: Sql, trips: TestTrip[]): Promise<string[]> {
  const rows = trips.map((t) => ({
    trip_id: fixedId(),
    operator_id: t.operatorId,
    device_id: t.deviceId ?? fixedId(),
    vehicle_type: t.type ?? "scooter",
    start_time: new Date(t.end - (t.durationS ?? 600) * 1000),
    end_time: new Date(t.end),
    billing_month: t.month,
    duration_s: t.durationS ?? 600,
    distance_m: t.distanceM ?? 2000,
    start_lng: -111.89123456,
    start_lat: 40.76123456,
    end_lng: -111.88123456,
    end_lat: 40.76523456,
    start_h3: t.startH3 ?? "892696ab607ffff",
    end_h3: t.endH3 ?? "892696ab607ffff",
    touches_equity_zone: t.equity ?? false,
    ends_outside_service_area: false,
  }));
  for (let i = 0; i < rows.length; i += 500) await sql`insert into trips ${sql(rows.slice(i, i + 500))}`;
  const routed = rows.filter((_, i) => trips[i]!.route).map((r) => r.trip_id);
  if (routed.length > 0) await sql`update trips set route = st_setsrid(st_makeline(st_makepoint(start_lng, start_lat), st_makepoint(end_lng, end_lat)), 4326) where trip_id in ${sql(routed)}`;
  return rows.map((r) => r.trip_id);
}

export { DAY as TEST_DAY };
