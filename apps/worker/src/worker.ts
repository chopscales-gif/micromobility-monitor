// The ingestion worker. Four scheduled jobs, queued in Postgres by pg-boss:
//
//   live     every minute      current vehicle and station status, recent events
//   hourly   every five minutes  finished hours of trips, events and location points
//   rules    every ten minutes   the city's rules applied to the last two days; findings go into cases, then alerts
//                               are raised for whoever needs to know and the daily summaries written to the outbox
//   daily    once a day        vehicle roster, operators' monthly reports, invoices, the city's own monthly report to the outbox,
//                               clearing old location points and routes past their keeping time
//   reset    once a night      only with DEMO_RESET set: puts the demonstration back as it was seeded (see demo-state.ts)
//
// Each job is safe to repeat, so a missed or doubled run does no harm.

import { localDate, routeRetentionDays } from "@mm/core";
import { connect } from "@mm/db";
import { catchUp, createContext, detectViolations, fetchReport, raiseAlerts, resetDemo, sendDigests, generateInvoice, loadOperators, pollRealtime, loadZones, pollRoster, monthEnd, purgeTelemetry, TELEMETRY_KEEP_MS } from "@mm/ingest";
import { PgBoss } from "pg-boss";
import { feedFetcher } from "./feeds";

const { sql } = connect(undefined, { max: 4 });
const feeds = await feedFetcher(sql);
const ctx = await createContext(sql, feeds.fetcher);
const boss = new PgBoss(process.env.DATABASE_URL!);
boss.on("error", (error) => console.error("Queue error:", error));

let lastStatic = 0;

async function live() {
  // Feed descriptions and station lists change rarely; once an hour is plenty.
  const includeStatic = Date.now() - lastStatic > 3_600_000;
  if (includeStatic) lastStatic = Date.now();
  await Promise.all((await loadOperators(sql)).map((op) => pollRealtime(ctx, op, { store: true, includeStatic })));
}

async function hourly() {
  // Zones can be drawn or retired at any time; rides are tested against the current set.
  ctx.zones = await loadZones(sql);
  for (const op of await loadOperators(sql)) {
    if (ctx.vehicleTypes.size === 0) await pollRoster(ctx, op);
    const result = await catchUp(ctx, op, { maxHours: 12 });
    if (result.hours > 0) ctx.log(`${op.name}: ingested ${result.hours} hour${result.hours === 1 ? "" : "s"}`);
  }
}

async function rules() {
  const now = Date.now();
  const result = await detectViolations(sql, { from: now - 2 * 86_400_000, to: now });
  if (result.created > 0) ctx.log(`Rule engine: ${result.created} new finding${result.created === 1 ? "" : "s"}`);
  const raised = await raiseAlerts(sql, now);
  if (raised > 0) ctx.log(`Alerts: ${raised} raised`);
  await sendDigests(sql, now);
}

async function daily() {
  const [year, month] = localDate(Date.now()).split("-").map(Number) as [number, number];
  const previous = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  const period = `${previous.year}-${String(previous.month).padStart(2, "0")}`;
  for (const op of await loadOperators(sql)) {
    await pollRoster(ctx, op);
    const [existing] = await sql`select reported_trips from invoices where operator_id = ${op.id} and year = ${previous.year} and month = ${previous.month}`;
    // Last month's invoice is drawn up once the operator's report is in, and not redrawn after that.
    if (existing?.reported_trips == null && (await fetchReport(ctx, op, period))) {
      await generateInvoice(sql, op, previous.year, previous.month);
      ctx.log(`${op.name}: invoice for ${period} calculated`);
    }
  }
  await purgeTelemetry(ctx, Date.now() - TELEMETRY_KEEP_MS);
  const done = await monthEnd(sql, Date.now(), routeRetentionDays(process.env.ROUTE_RETENTION_DAYS));
  if (done.written > 0) ctx.log(`Monthly report for ${done.period} written to the outbox for ${done.written} ${done.written === 1 ? "person" : "people"}`);
  if (done.purged > 0) ctx.log(`Routes older than ${done.retentionDays} days deleted from ${done.purged} rides`);
}

/** Visitors to a hosted demonstration share one database; each night it is put back as it was seeded. */
async function reset() {
  ctx.log((await resetDemo(sql)) ? "Demonstration reset: zones, rules, fees, invoices, cases, alerts, outbox and audit log are as seeded" : "Demonstration reset skipped: one was already running");
}

const DEMO_RESET = Boolean(process.env.DEMO_RESET);

const jobs: [name: string, cron: string, run: () => Promise<void>][] = [
  ["live", "* * * * *", live],
  ["hourly", "*/5 * * * *", hourly],
  ["rules", "*/10 * * * *", rules],
  ["daily", "20 9 * * *", daily],
  // 10:00 UTC is three or four in the morning in the demonstration's city.
  ...(DEMO_RESET ? ([["reset", "0 10 * * *", reset]] as [string, string, () => Promise<void>][]) : []),
];

await boss.start();
for (const [name, cron, run] of jobs) {
  await boss.createQueue(name);
  await boss.schedule(name, cron);
  await boss.work(name, async () => {
    try {
      await run();
    } catch (error) {
      console.error(`Job ${name} failed:`, error);
      throw error;
    }
  });
}
// A schedule outlives the process that made it; without the setting, no reset is left waiting in the queue.
if (!DEMO_RESET) await boss.unschedule("reset").catch(() => {});
console.log(`Worker started: polling operator feeds${feeds.inProcess ? `, simulated inside this process at ${feeds.inProcess}` : ""}.${DEMO_RESET ? " The demonstration is reset each night." : ""}`);
// Catch up straight away rather than waiting for the first tick.
await live().catch((error) => console.error(error));
await hourly().catch((error) => console.error(error));
await rules().catch((error) => console.error(error));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await boss.stop();
    await sql.end();
    process.exit(0);
  });
}
