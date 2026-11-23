// Fills an empty database with a believable city: operators, zones, a fee
// schedule, and several months of history replayed from the simulated feeds
// through the same ingestion code the live worker uses.
//
//   npm run db:seed                 one full month plus the month to date (about 400 MB, two to three minutes)
//   SEED_MONTHS=3 npm run db:seed   more history, for the trend charts; allow about 1 GB of disk
//   npm run db:seed -- --violations rebuilds only the cases, alerts and outbox, from the history already stored

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { addDays, caseWeek, CITY_TIME_ZONE, localDate, routeRetentionDays, RULE_KINDS, RULES, startOfLocalDay, type CaseAction, type RuleKind } from "@mm/core";
import { connect, encryptToken, type Sql } from "@mm/db";
import { actOnCase, catchUp, createContext, detectViolations, DIGEST_HOUR, raiseAlerts, ruleOnFinding, sendDigests, type CaseActor, fetchReport, generateInvoice, loadOperators, pollRealtime, pollRoster, purgeTelemetry, sendMonthlyReport, TELEMETRY_KEEP_MS, type Operator } from "@mm/ingest";
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

/** The six seats, one person each, and an account for each operator. Safe to run on a database that already has people. */
async function people(sql: Sql) {
  const ids = Object.fromEntries((await sql`select id, slug from operators`).map((r) => [r.slug, r.id]));
  const users: [string, string, string, string, string | null][] = [
    ["Marisol Vega", "marisol.vega@city-demo.example", "Mobility Program Manager", "program_manager", null],
    ["Devin Okafor", "devin.okafor@city-demo.example", "Compliance Analyst", "analyst", null],
    ["Priya Raman", "priya.raman@city-demo.example", "Revenue Analyst, Finance", "finance", null],
    ["Tomasz Brandt", "tomasz.brandt@city-demo.example", "IT Systems Administrator", "admin", null],
    ["Ruth Halloran", "ruth.halloran@city-demo.example", "Council Office Liaison", "read_only", null],
    ["Kestrel Mobility", "ops@kestrel-demo.example", "Operator account", "operator", "kestrel"],
    ["Pronghorn Rides", "ops@pronghorn-demo.example", "Operator account", "operator", "pronghorn"],
    ["Saltgrass Bikeshare", "ops@saltgrass-demo.example", "Operator account", "operator", "saltgrass"],
  ];
  for (const [name, email, title, role, slug] of users) {
    const updated = await sql`update users set name = ${name}, title = ${title}, role = ${role}, operator_id = ${slug ? ids[slug] : null} where email = ${email} returning id`;
    if (updated.length === 0) await sql`insert into users (name, email, title, role, operator_id) values (${name}, ${email}, ${title}, ${role}, ${slug ? ids[slug] : null})`;
  }
}

/** The rules and seeded zones came into force with the 2026 permit terms. */
const ADOPTED = "2026-01-01T07:00:00Z";

async function adoptRules(sql: Sql) {
  for (const kind of RULE_KINDS) {
    await sql`insert into rules (kind, params, effective_from, updated_by, updated_at) values (${kind}, ${sql.json(RULES[kind].defaults)}, ${ADOPTED}, 'Marisol Vega', '2025-12-09 21:20:00+00')
      on conflict (kind) do nothing`;
  }
}

type Who = "analyst" | "manager" | "operator";
/** One thing done to a case: who did it, how many days after the case's week ended, at what hour, and what they wrote. */
type Step = [action: CaseAction, who: Who, day: number, hour: number, note: string];

const NOTICE: Record<RuleKind, string> = {
  fleet_cap: "The fleet was over the permitted number on the days listed. Tell us what has been done to bring it back under the permit, or dispute the count.",
  equity_minimum: "The morning count in the equity zones was below the required share on the days listed. Tell us how vehicles will be redeployed, or dispute the count.",
  parking_dwell: "The vehicles listed stood in one place for longer than the limit. Tell us they have been collected, or dispute any that were not where the record says.",
  rebalancing_sla: "More badly parked vehicles were left past the deadline than the daily allowance, on the days listed. Tell us what has changed in your collection rounds, or dispute the record.",
  slow_zone_speed: "More rides than the rule allows went through slow zones above the limit on the days listed. Tell us when speed limiting inside these zones will be in place, or dispute the measurements.",
};
const FIXED: Record<RuleKind, [reply: string, close: string]> = {
  fleet_cap: ["The extra vehicles were collected on Tuesday and our deployment tool now stops at the permitted number.", "Counts since the reply are under the permit. Closed."],
  equity_minimum: ["We have added a 6 am drop at four west-side corners from next Monday.", "The morning drop is on the schedule the operator sent. To be judged on the following weeks' counts. Closed."],
  parking_dwell: ["All of the vehicles listed have been collected. Several had flat batteries and were not showing on our crew's route.", "Checked against the feed: every vehicle listed has moved or left the street. Closed."],
  rebalancing_sla: ["We have added an evening collection run downtown and the crew now works from the city's zone map.", "Missed deadlines fell back inside the allowance in the days after the reply. Closed."],
  slow_zone_speed: ["A firmware update with speed limiting inside the city's slow zones is being rolled out across the fleet.", "The operator has given a date for the firmware update. The notice stands; the weeks after it will show whether it worked. Closed."],
};

/** What happened to each case, by operator, rule and how many weeks ago its week began. Anything not listed is left as the engine filed it. */
function script(slug: string, rule: RuleKind, weeksAgo: number, ladderFrom: string): Step[] {
  const [reply, close] = FIXED[rule];
  const worked = (noticeDay: number, replyDay: number, closeDay: number): Step[] => [["notice", "analyst", noticeDay, 10, NOTICE[rule]], ["reply", "operator", replyDay, 14, reply], ["resolve", "analyst", closeDay, 11, close]];
  // Before the ladder was adopted, breaches were raised on the weekly call and nothing was put in writing.
  if (weeksAgo >= 4 && slug !== "saltgrass") return [["close", "analyst", 1, 9, `Raised on the weekly operator call. Closed without a notice: the escalation ladder was adopted on ${ladderFrom}, and weeks before it are not counted.`]];

  if (slug === "pronghorn") {
    if (weeksAgo === 3) return worked(0, 2, 4);
    if (rule === "fleet_cap") {
      if (weeksAgo === 2) return [
        ["notice", "analyst", 0, 10, NOTICE[rule]],
        ["dispute", "operator", 1, 16, "The extra vehicles were deployed for the downtown arts festival under special event permit SE-2026-118, which allows 60 vehicles above our cap while the festival is on."],
        ["withdraw", "analyst", 3, 15, "Confirmed with the events office: permit SE-2026-118 covered the festival days. Withdrawn. The cap in this system did not know about the event permit."],
      ];
      if (weeksAgo === 1) return [["notice", "analyst", 0, 10, NOTICE[rule]], ["reply", "operator", 3, 13, "Forty vehicles were taken off the street on Wednesday. We are asking for the additional 50 devices approved in October to be reflected in the cap for the days before the 15th."]];
    }
    if (rule === "equity_minimum") {
      if (weeksAgo === 2) return [["notice", "analyst", 1, 10, NOTICE[rule]]];
    }
    if (rule === "parking_dwell") {
      if (weeksAgo === 2) return worked(0, 2, 3);
      if (weeksAgo === 1) return [["notice", "analyst", 0, 11, NOTICE[rule]]];
    }
    if (rule === "rebalancing_sla") {
      if (weeksAgo === 2) return worked(0, 3, 4);
      if (weeksAgo === 1) return [
        ["notice", "analyst", 0, 11, NOTICE[rule]],
        ["dispute", "operator", 2, 15, "Some of the vehicles counted were at the racks beside the Gallivan Center, which sit on the edge of the no-parking zone as drawn. We ask for those to be taken out and the days counted again."],
      ];
    }
    if (rule === "slow_zone_speed") {
      if (weeksAgo === 2) return worked(0, 1, 3);
      if (weeksAgo === 1) return worked(0, 2, 3);
      if (weeksAgo === 0) return [["notice", "manager", -3, 15, `${NOTICE[rule]} This is the fourth week with a notice on this rule. The permit is referred for a suspension review; the hearing date will follow by letter.`]];
    }
  }
  if (slug === "kestrel") {
    if (rule === "parking_dwell") {
      if (weeksAgo === 3) return [["close", "analyst", 0, 10, "Four vehicles, all collected within a day of the limit. Raised by phone; no notice."]];
      if (weeksAgo === 2) return worked(0, 1, 2);
      if (weeksAgo === 1) return [["notice", "analyst", 1, 10, NOTICE[rule]], ["reply", "operator", 4, 9, "Six of the seven have been collected. The seventh is inside a locked courtyard on 300 South and we are waiting for the building manager."]];
    }
    if (rule === "rebalancing_sla" && weeksAgo === 3) return worked(0, 1, 2);
  }
  if (slug === "saltgrass") {
    if (weeksAgo >= 4) return [["close", "analyst", 2, 10, "Could not be confirmed: the operator's status feed was rejecting records at the time, so the stay cannot be shown to be unbroken. Closed without a notice. The feed fault has been raised with the operator."]];
    if (weeksAgo === 2) return worked(1, 2, 3);
  }
  return [];
}

/**
 * Gives the cases a believable past: staff have been working them, operators have answered, one notice was
 * disputed and withdrawn, one is overdue. Every step goes through the same code the application uses.
 */
async function workCases(sql: Sql, now: number) {
  const users = await sql`select id, name, role, operator_id from users`;
  const seat = (role: string) => users.find((u) => u.role === role)!;
  const actors: Record<Who, (operatorId: string) => CaseActor> = {
    analyst: () => ({ userId: seat("analyst").id, name: seat("analyst").name, operatorId: null, mayEscalate: false }),
    manager: () => ({ userId: seat("program_manager").id, name: seat("program_manager").name, operatorId: null, mayEscalate: true }),
    operator: (operatorId) => {
      const u = users.find((x) => x.operator_id === operatorId)!;
      return { userId: u.id, name: u.name, operatorId, mayEscalate: false };
    },
  };
  const thisWeek = caseWeek(now);
  const ladderFrom = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", day: "numeric" }).format(Date.parse(`${addDays(thisWeek, -21)}T00:00:00Z`));
  const analyst = { name: seat("analyst").name as string };

  const cases = await sql`select c.number, c.rule_kind, c.operator_id, c.week_start::text as week_start, o.slug from cases c join operators o on o.id = c.operator_id order by c.week_start, c.number`;
  for (const c of cases) {
    const weeksAgo = Math.round((Date.parse(thisWeek) - Date.parse(c.week_start)) / (7 * DAY));
    const weekEnd = addDays(c.week_start, 7);
    const at = (day: number, hour: number) => startOfLocalDay(addDays(weekEnd, day)) + hour * HOUR + ((Number(c.number) * 7) % 50) * 60_000;

    // One of Saltgrass's held findings was checked on the street and released, so it has a case that went to notice.
    if (c.slug === "saltgrass" && weeksAgo === 2) {
      const [held] = await sql`select v.number from violations v join cases k on k.id = v.case_id where k.number = ${c.number} and v.standing = 'held' order by v.number limit 1`;
      if (held && at(0, 15) < now) await ruleOnFinding(sql, Number(held.number), "counted", analyst, "Field check: the bike was at the rack on 400 West with a flat tyre and a full layer of leaves on the saddle. It has not moved. Released.", at(0, 15));
    }
    // And one of Pronghorn's was at its own depot, which the city agreed is not the street.
    if (c.slug === "pronghorn" && c.rule_kind === "parking_dwell" && weeksAgo === 1) {
      const [first] = await sql`select v.number from violations v join cases k on k.id = v.case_id where k.number = ${c.number} order by v.number limit 1`;
      if (first && at(0, 9) < now) await ruleOnFinding(sql, Number(first.number), "set_aside", analyst, "This vehicle was in the operator's depot yard, which is private land and not on the street. Set aside.", at(0, 9));
    }

    for (const [action, who, day, hour, note] of script(c.slug, c.rule_kind, weeksAgo, ladderFrom)) {
      const when = at(day, hour);
      if (when > now - HOUR) break;
      const problem = await actOnCase(sql, Number(c.number), action, actors[who](c.operator_id), note, when);
      if (problem) throw new Error(`Seeding case ${c.number} (${c.slug}, ${c.rule_kind}, ${c.week_start}): ${action} failed: ${problem}`);
    }
  }
}

/** Raises the alerts the last week called for, and the emails they would have produced, as if the worker had been running throughout. */
async function seedAlerts(sql: Sql, now: number) {
  await raiseAlerts(sql, now);
  const today = localDate(now);
  for (let back = 6; back >= 0; back--) {
    const morning = startOfLocalDay(addDays(today, -back)) + DIGEST_HOUR * HOUR;
    if (morning <= now) await sendDigests(sql, morning);
  }
  // The monthly report for each finished month on record, written on the first morning of the month after.
  for (let back = MONTHS; back >= 1; back--) {
    const { year, month } = monthStart(now, back);
    let morning = startOfLocalDay(monthStart(now, back - 1).date) + DIGEST_HOUR * HOUR;
    // The first of November can be the day the clocks go back, which makes its morning an hour later.
    const localHour = Number(new Intl.DateTimeFormat("en-US", { timeZone: CITY_TIME_ZONE, hour: "numeric", hourCycle: "h23" }).format(morning));
    morning += (DIGEST_HOUR - localHour) * HOUR;
    await sendMonthlyReport(sql, year, month, morning);
  }
  // Anything more than a day and a half old has been seen.
  await sql`update alerts set read_at = at + interval '3 hours' where at < ${new Date(now - 36 * HOUR)}`;
}

/** Runs the rule engine over the whole stored history, then works the queue. */
async function violations(sql: Sql, now: number) {
  await sql`truncate cases, case_events, violations, alerts, outbox restart identity cascade`;
  await people(sql);
  await adoptRules(sql);
  const [first] = await sql`select min(ts) as ts from status_events`;
  if (!first?.ts) return;
  const result = await detectViolations(sql, { from: first.ts.getTime(), to: now });
  if (process.argv.includes("--raw")) return;
  await workCases(sql, now);
  // The first run filed the history; this one sees it as the worker would, with the cases as staff left them.
  await detectViolations(sql, { from: now - 2 * DAY, to: now });
  await seedAlerts(sql, now);
  console.log(`Rule engine: ${result.created} findings filed.`);
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

  const now = Date.now();
  const { sql } = connect(undefined, { max: 2 });
  if (process.argv.includes("--violations")) {
    await violations(sql, now);
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

  console.log("Applying the city's rules to the history...");
  await violations(sql, now);

  await sql`analyze`;
  const [counts] = await sql`select (select count(*) from trips)::int as trips, (select count(*) from trips where route is not null)::int as routes,
    (select count(*) from status_events)::int as events, (select count(*) from feed_polls)::int as polls, (select count(*) from invoices)::int as invoices,
    pg_size_pretty(pg_database_size(current_database())) as size`;
  console.log(`Done: ${counts!.trips} trips (${counts!.routes} with routes), ${counts!.events} status changes, ${counts!.polls} feed polls, ${counts!.invoices} invoices. Database size ${counts!.size}.`);
  await sql.end();
}

await main();
