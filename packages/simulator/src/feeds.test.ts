import { validateFeed, type FeedId } from "@mm/core/validate";
import { describe, expect, it } from "vitest";
import { feedCondition } from "./faults";
import { handleSimRequest } from "./handler";
import { monthlyReport } from "./reports";
import { HOUR_MS } from "./time";
import { operatorBySlug, OPERATORS } from "./world";

const SEED = "test-seed";
const NOW = Date.parse("2026-11-18T21:30:00Z"); // a Wednesday, 14:30 in Utah
const HOUR = "2026-11-18T19";

function get(path: string, query: Record<string, string> = {}, token?: string, now = NOW) {
  return handleSimRequest({
    path,
    query: new URLSearchParams(query),
    headers: { authorization: token ? `Bearer ${token}` : null },
    baseUrl: "http://sim.test",
    seed: SEED,
    now,
  });
}

/** A moment when the operator's API is up, at or after `from`. */
function upMoment(slug: string, from = NOW): number {
  const op = operatorBySlug(slug)!;
  let t = from;
  while (feedCondition(SEED, op, t).outage || feedCondition(SEED, op, t).frozenAt) t += 60_000;
  return t;
}

function allFeeds(slug: string): [FeedId, ReturnType<typeof validateFeed>][] {
  const op = operatorBySlug(slug)!;
  const now = upMoment(slug);
  const gbfs = `/${slug}/gbfs/3.0`;
  const mds = `/${slug}/mds`;
  const calls: [FeedId, string, Record<string, string>][] = [
    ["gbfs.gbfs", `${gbfs}/gbfs.json`, {}],
    ["gbfs.system_information", `${gbfs}/system_information.json`, {}],
    ["gbfs.vehicle_types", `${gbfs}/vehicle_types.json`, {}],
    ["gbfs.vehicle_status", `${gbfs}/vehicle_status.json`, {}],
    ["gbfs.geofencing_zones", `${gbfs}/geofencing_zones.json`, {}],
    ["mds.vehicles", `${mds}/vehicles`, { "page[size]": "1000" }],
    ["mds.vehicles_status", `${mds}/vehicles/status`, { "page[size]": "1000" }],
    ["mds.trips", `${mds}/trips`, { end_time: HOUR }],
    ["mds.telemetry", `${mds}/telemetry`, { telemetry_time: HOUR }],
    ["mds.events_historical", `${mds}/events/historical`, { event_time: HOUR }],
    ["mds.events_recent", `${mds}/events/recent`, { start_time: String(now - HOUR_MS), end_time: String(now), "page[size]": "1000" }],
  ];
  if (op.stations > 0) {
    calls.push(["gbfs.station_information", `${gbfs}/station_information.json`, {}], ["gbfs.station_status", `${gbfs}/station_status.json`, {}], ["mds.stops", `${mds}/stops`, {}]);
  }
  return calls.map(([feed, path, query]) => {
    const response = get(path, query, op.token, now);
    expect(response.status, `${feed} status`).toBe(200);
    return [feed, validateFeed(feed, JSON.parse(response.body))];
  });
}

describe("simulated feeds against the official schemas", () => {
  it("the well-run operator's feeds are valid in every record", () => {
    for (const [feed, result] of allFeeds("kestrel")) {
      expect(result.envelopeIssues, feed).toEqual([]);
      expect(result.invalidRecords.map((r) => r.issues), feed).toEqual([]);
    }
  });

  it("the careless operator's feeds contain broken records, and only a few percent of them", () => {
    let records = 0;
    let invalid = 0;
    for (const [feed, result] of allFeeds("saltgrass")) {
      expect(result.envelopeIssues, feed).toEqual([]);
      records += result.recordCount;
      invalid += result.invalidRecords.length;
    }
    expect(invalid).toBeGreaterThan(10);
    expect(invalid / records).toBeLessThan(0.06);
  });

  it("serves a fleet of the size the brief asks for", () => {
    const scooters = OPERATORS.reduce((n, op) => n + op.scooters, 0);
    const bikes = OPERATORS.reduce((n, op) => n + op.bikes, 0);
    expect(scooters).toBe(1500);
    expect(bikes).toBe(300);
  });
});

describe("MDS API behaviour", () => {
  const trips = (query: Record<string, string>, token?: string) => get("/kestrel/mds/trips", query, token);

  it("needs the operator's own bearer token", () => {
    expect(trips({ end_time: HOUR }).status).toBe(401);
    expect(trips({ end_time: HOUR }, "demo-token-pronghorn").status).toBe(401);
    expect(trips({ end_time: HOUR }, "demo-token-kestrel").status).toBe(200);
  });

  it("answers 400 without an hour, 202 for the hour in progress, 404 for a future hour", () => {
    expect(trips({}, "demo-token-kestrel").status).toBe(400);
    expect(trips({ end_time: "2026-11-18T21" }, "demo-token-kestrel").status).toBe(202);
    expect(trips({ end_time: "2026-11-19T21" }, "demo-token-kestrel").status).toBe(404);
  });

  it("refuses a version it does not serve", () => {
    const response = handleSimRequest({
      path: "/kestrel/mds/vehicles",
      query: new URLSearchParams(),
      headers: { authorization: "Bearer demo-token-kestrel", accept: "application/vnd.mds+json;version=1.2" },
      baseUrl: "http://sim.test",
      seed: SEED,
      now: NOW,
    });
    expect(response.status).toBe(406);
  });

  it("pages the vehicle list and ends with a null next link", () => {
    const seen = new Set<string>();
    let query: Record<string, string> = { "page[size]": "300" };
    for (let guard = 0; guard < 10; guard++) {
      const body = JSON.parse(get("/kestrel/mds/vehicles", query, "demo-token-kestrel").body);
      for (const v of body.vehicles) seen.add(v.device_id);
      if (body.links.next === null) break;
      query = Object.fromEntries(new URL(body.links.next).searchParams);
    }
    expect(seen.size).toBe(820);
  });

  it("is repeatable: the same request gives the same answer", () => {
    const a = trips({ end_time: HOUR }, "demo-token-kestrel").body;
    const b = trips({ end_time: HOUR }, "demo-token-kestrel").body;
    expect(a).toBe(b);
  });

  it("every trip in an hour ended in that hour, and trip events carry its id", () => {
    const hourStart = Date.parse(`${HOUR}:00:00Z`);
    const list = JSON.parse(trips({ end_time: HOUR }, "demo-token-kestrel").body).trips as { trip_id: string; end_time: number }[];
    expect(list.length).toBeGreaterThan(20);
    for (const t of list) expect(t.end_time >= hourStart && t.end_time < hourStart + HOUR_MS).toBe(true);
    const events = JSON.parse(get("/kestrel/mds/events/historical", { event_time: HOUR }, "demo-token-kestrel").body).events as { event_types: string[]; trip_ids?: string[] }[];
    const ended = new Set(events.filter((e) => e.event_types.includes("trip_end")).map((e) => e.trip_ids![0]));
    const inArea = list.filter((t) => ended.has(t.trip_id));
    expect(inArea.length).toBeGreaterThan(list.length * 0.95);
  });
});

describe("feed faults", () => {
  it("the careless operator has outages; the well-run one never does", () => {
    const day = Array.from({ length: 24 * 60 }, (_, minute) => NOW - minute * 60_000);
    const down = (slug: string) => day.filter((t) => feedCondition(SEED, operatorBySlug(slug)!, t).outage).length;
    expect(down("kestrel")).toBe(0);
    expect(down("saltgrass")).toBeGreaterThan(5);
    expect(down("saltgrass")).toBeLessThan(120);
  });

  it("an outage answers 503 on every feed", () => {
    const op = operatorBySlug("saltgrass")!;
    let t = NOW;
    while (!feedCondition(SEED, op, t).outage) t -= 60_000;
    expect(get("/saltgrass/gbfs/3.0/vehicle_status.json", {}, undefined, t).status).toBe(503);
    expect(get("/saltgrass/mds/vehicles", {}, op.token, t).status).toBe(503);
  });

  it("a frozen feed keeps serving an old last_updated", () => {
    const op = operatorBySlug("saltgrass")!;
    let t = NOW;
    for (let i = 0; i < 20 * 24 * 60 && !(feedCondition(SEED, op, t).frozenAt && !feedCondition(SEED, op, t).outage); i++) t -= 60_000;
    const frozenAt = feedCondition(SEED, op, t).frozenAt!;
    expect(frozenAt).toBeLessThanOrEqual(t);
    const body = JSON.parse(get("/saltgrass/mds/vehicles/status", {}, op.token, t).body);
    expect(body.last_updated).toBe(frozenAt);
  });
});

describe("operator monthly reports", () => {
  it("the under-reporting operator leaves out about three percent of its trips", () => {
    const report = monthlyReport(SEED, operatorBySlug("pronghorn")!, "2026-10");
    const reported = report.rows.filter((r) => r.specialGroup === "all_riders").reduce((n, r) => n + r.tripCount, 0);
    const share = report.omitted / (reported + report.omitted);
    expect(share).toBeGreaterThan(0.025);
    expect(share).toBeLessThan(0.037);
  });

  it("the honest operator leaves out none", () => {
    expect(monthlyReport(SEED, operatorBySlug("kestrel")!, "2026-10").omitted).toBe(0);
  });

  it("publishes a report only after the month ends", () => {
    expect(get("/kestrel/mds/reports/2026-11.csv", {}, "demo-token-kestrel").status).toBe(404);
    const october = get("/kestrel/mds/reports/2026-10.csv", {}, "demo-token-kestrel");
    expect(october.status).toBe(200);
    expect(october.body.split("\n")[0]).toBe("provider_id,start_date,duration,special_group_type,geography_id,vehicle_type,trip_count,rider_count");
  });
});
