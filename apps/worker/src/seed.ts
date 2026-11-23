// Fills an empty database with a believable city: operators, zones, a fee
// schedule, and several months of history replayed from the simulated feeds
// through the same ingestion code the live worker uses.
//
//   npm run db:seed                 one full month plus the month to date (about 400 MB, two to three minutes)
//   SEED_MONTHS=3 npm run db:seed   more history, for the trend charts; allow about 1 GB of disk
//   npm run db:seed -- --violations rebuilds only the cases, alerts and outbox, from the history already stored

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { clock as present, localDate, routeRetentionDays, startOfLocalDay } from "@mm/core";
import { connect, encryptToken, type Sql } from "@mm/db";
import { ADOPTED, adoptRules, catchUp, createContext, fetchReport, generateInvoice, issueOpeningInvoices, loadOperators, people, pollRealtime, pollRoster, purgeTelemetry, rebuildCases, TELEMETRY_KEEP_MS, type Operator } from "@mm/ingest";
import { OPERATORS, providerId, simFetcher, ZONES } from "@mm/simulator";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const SEED = process.env.SIM_SEED ?? "slc-demo";
const SIMULATOR_URL = (process.env.SIMULATOR_URL ?? "http://localhost:4010").replace(/\/$/, "");
/** Full calendar months of history before the current month. */
const MONTHS = Number(process.env.SEED_MONTHS ?? 1);
/** Routes older than this are not kept, so there is no point building them. */
const ROUTE_RETENTION_DAYS = routeRetentionDays(process.env.ROUTE_RETENTION_DAYS);
/** How far back the live feeds are sampled, to give the health scores a history. */
const HEALTH_HISTORY_DAYS = Number(process.env.HEALTH_HISTORY_DAYS ?? 14);
const HEALTH_SAMPLE_MS = 15 * 60_000;

const pad = (n: number) => String(n).padStart(2, "0");

/** The first day of the month, `back` months before the month containing `now`. */
function monthStart(now: number, back: number): { year: number; month: number; date: string } {
  const [y, m] = localDate(now).split("-").map(Number) as [number, number];
  const index = y * 12 + (m - 1) - back;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return { year, month, date: `${year}-${pad(month)}-01` };
}

async function reference(sql: Sql, now: number) {
  await sql`truncate operators, feed_polls, schema_errors, vehicles, vehicle_status, stations, status_events, telemetry, trips, zones, fee_schedules, permits, operator_reports, invoices, invoice_lines, users, audit_log, rules, cases, case_events, violations, alerts, outbox, zone_passes restart identity cascade`;

  const history = monthStart(now, MONTHS);
  const historyStart = Math.floor(startOfLocalDay(history.date) / HOUR) * HOUR;

  for (const op of OPERATORS) {
    await sql`insert into operators (slug, name, provider_id, gbfs_url, mds_url, mds_token_encrypted, ingested_through)
      values (${op.slug}, ${op.name}, ${providerId(op)}, ${`${SIMULATOR_URL}/${op.slug}/gbfs/3.0/gbfs.json`}, ${`${SIMULATOR_URL}/${op.slug}/mds`}, ${encryptToken(op.token)}, ${new Date(historyStart)})`;
  }
  const ids = Object.fromEntries((await sql`select id, slug from operators`).map((r) => [r.slug, r.id]));

  for (const zone of ZONES) {
    const shape = JSON.stringify({ type: "MultiPolygon", coordinates: [zone.polygon] });
    await sql`insert into zones (slug, name, type, geom, speed_limit_kph, effective_from, created_by) values (${zone.slug}, ${zone.name}, ${zone.type}, st_setsrid(st_geomfromgeojson(${shape}), 4326), ${zone.speedLimitKph ?? null}, ${ADOPTED}, 'Marisol Vega')`;
  }

  await adoptRules(sql);

  await sql`insert into fee_schedules (effective_from, per_device_annual_cents, per_ride_cents, min_billable_trip_seconds, exempt_equity_zone_trips, discrepancy_tolerance_pct, discrepancy_tolerance_trips, note, created_by, created_at)
    values ('2026-01-01', 3500, 20, 60, true, 1, 25, 'Adopted with the 2026 shared mobility permit terms.', 'Marisol Vega', '2025-12-09 21:15:00+00')`;

  // Pronghorn's mid-October addition shows the permit fee being prorated by days in force.
  const permits: [string, number, string, string][] = [
    ["kestrel", 850, "2026-01-01", "Annual permit"],
    ["pronghorn", 500, "2026-01-01", "Annual permit"],
    ["pronghorn", 50, "2026-10-15", "Additional devices approved 15 October"],
    ["saltgrass", 400, "2026-03-01", "Annual permit"],
  ];
  for (const [slug, devices, start, note] of permits) {
    await sql`insert into permits (operator_id, devices, start_date, note) values (${ids[slug]}, ${devices}, ${start}, ${note})`;
  }

  await people(sql);
  return historyStart;
}

/** Replays one operator's history hour by hour, as the live worker would have seen it. */
async function backfill(slug: string, now: number) {
  const { sql } = connect(undefined, { max: 2 });
  let clock = now;
  const ctx = await createContext(sql, simFetcher({ seed: SEED, baseUrl: SIMULATOR_URL, now: () => clock }), () => clock);
  ctx.log = () => {};
  const op = (await loadOperators(sql)).find((o) => o.slug === slug) as Operator;
  const start = op.ingestedThrough!;
  const routesFrom = now - ROUTE_RETENTION_DAYS * DAY;
  const samplesFrom = now - HEALTH_HISTORY_DAYS * DAY;
  const lastHour = Math.floor((now - HOUR - 6 * 60_000) / HOUR) * HOUR;

  clock = start;
  await pollRoster(ctx, op);
  if (ctx.vehicleTypes.size === 0) {
    clock = start + 2 * HOUR; // the operator's server was down at that moment; try a little later
    await pollRoster(ctx, op);
  }

  const started = Date.now();
  for (let hour = start; hour <= lastHour; hour += HOUR) {
    // The file for an hour is fetched six minutes after the hour ends; if the server is down, again every ten minutes.
    clock = hour + HOUR + 6 * 60_000;
    for (let attempt = 0; attempt < 30; attempt++, clock += 10 * 60_000) {
      const result = await catchUp(ctx, op, { maxHours: 1, routes: (h) => h >= routesFrom, keepPoints: (h) => h >= now - TELEMETRY_KEEP_MS });
      if (result.hours === 1 || op.ingestedThrough! > hour) break;
    }

    if (hour >= samplesFrom) {
      for (let t = hour; t < hour + HOUR; t += HEALTH_SAMPLE_MS) {
        clock = t;
        await pollRealtime(ctx, op, { store: false, includeStatic: t % DAY === 0 });
      }
    }
    if (hour % DAY === 0) {
      const done = (hour - start) / (lastHour - start || 1);
      if ((hour / DAY) % 7 === 0) console.log(`  ${op.name}: ${localDate(hour)} (${Math.round(done * 100)}%)`);
    }
  }

  clock = now;
  await pollRealtime(ctx, op, { store: true, includeStatic: true });
  await purgeTelemetry(ctx, now - TELEMETRY_KEEP_MS);
  console.log(`  ${op.name}: done in ${Math.round((Date.now() - started) / 1000)}s`);
  await sql.end();
}

function runChild(slug: string, now: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), "--backfill", slug, String(now)], { stdio: "inherit" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`Backfill of ${slug} failed`))));
  });
}

async function main() {
  const flag = process.argv.indexOf("--backfill");
  if (flag > 0) return backfill(process.argv[flag + 1]!, Number(process.argv[flag + 2]));

  // With DEMO_CLOCK set, the history ends at that instant, for a copy that will show it with the clock stopped there.
  const now = present();
  const { sql } = connect(undefined, { max: 2 });
  if (process.argv.includes("--violations")) {
    console.log(`Rule engine: ${await rebuildCases(sql, now, { raw: process.argv.includes("--raw") })} findings filed.`);
    return sql.end();
  }
  const [existing] = await sql`select count(*)::int as n from operators`;
  // Docker Compose seeds on first start only; running the command by hand always starts over.
  if (existing!.n > 0 && process.env.SEED_IF_EMPTY) {
    console.log("Database already has data; leaving it alone.");
    return sql.end();
  }

  console.log(`Seeding: ${MONTHS} full months of history plus the month to date. Simulated data; fictional operators.`);
  const historyStart = await reference(sql, now);
  console.log(`Replaying operator feeds from ${localDate(historyStart)} (one process per operator)...`);
  await Promise.all(OPERATORS.map((op) => runChild(op.slug, now)));

  console.log("Fetching operators' monthly reports and calculating invoices...");
  const clock = () => now;
  const ctx = await createContext(sql, simFetcher({ seed: SEED, baseUrl: SIMULATOR_URL, now: clock }), clock);
  for (const op of await loadOperators(sql)) {
    for (let back = MONTHS; back >= 1; back--) {
      const { year, month } = monthStart(now, back);
      await fetchReport(ctx, op, `${year}-${pad(month)}`);
      await generateInvoice(sql, op, year, month, now);
    }
  }

  await issueOpeningInvoices(sql, now);

  console.log("Applying the city's rules to the history...");
  console.log(`Rule engine: ${await rebuildCases(sql, now)} findings filed.`);

  await sql`analyze`;
  const [counts] = await sql`select (select count(*) from trips)::int as trips, (select count(*) from trips where route is not null)::int as routes,
    (select count(*) from status_events)::int as events, (select count(*) from feed_polls)::int as polls, (select count(*) from invoices)::int as invoices,
    pg_size_pretty(pg_database_size(current_database())) as size`;
  console.log(`Done: ${counts!.trips} trips (${counts!.routes} with routes), ${counts!.events} status changes, ${counts!.polls} feed polls, ${counts!.invoices} invoices. Database size ${counts!.size}.`);
  await sql.end();
}

await main();
