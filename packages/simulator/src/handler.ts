// One request handler for all three operators' feeds. It is framework-free so
// the same code runs behind the standalone simulator server and, on the hosted
// demo, behind a Next.js route.
//
//   GET /{operator}/gbfs/3.0/gbfs.json          public, no token
//   GET /{operator}/gbfs/3.0/{feed}.json
//   GET /{operator}/mds/{endpoint}              Authorization: Bearer <token>

import { feedCondition } from "./faults";
import { discovery, gbfsFeed, feedsFor, type GbfsFeed } from "./gbfs";
import { eventsBetween, MDS_VERSION, realtimeEnvelope, realtimeInstant, stops, telemetryBetween, tripsEndedBetween, vehicles, vehiclesStatus } from "./mds";
import { monthlyReportCsv } from "./reports";
import { HOUR_MS, localTime } from "./time";
import { operatorBySlug, OPERATORS, type OperatorProfile } from "./world";

export type SimRequest = {
  /** Path after the simulator's mount point, e.g. "/kestrel/mds/trips". */
  path: string;
  query: URLSearchParams;
  headers: { authorization?: string | null; accept?: string | null };
  /** Where the simulator is mounted, for links inside the feeds. No trailing slash. */
  baseUrl: string;
  seed: string;
  now: number;
};

export type SimResponse = {
  status: number;
  contentType: string;
  body: string;
  /** Time the caller should wait before answering, to imitate a slow server. */
  delayMs: number;
};

const MDS_JSON = `application/vnd.mds+json;version=${MDS_VERSION.slice(0, 3)}`;
const DEFAULT_PAGE_SIZE = 400;
const MAX_PAGE_SIZE = 1000;
const TWO_WEEKS_MS = 14 * 24 * HOUR_MS;

const json = (status: number, body: unknown, contentType = "application/json"): SimResponse => ({
  status,
  contentType,
  body: JSON.stringify(body),
  delayMs: 0,
});

const mdsError = (status: number, error: string, description: string) =>
  json(status, { error, error_description: description, error_details: [] }, MDS_JSON);

/** "2026-11-18T17" -> start of that UTC hour. */
function parseHour(value: string | null): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}$/.test(value)) return null;
  const t = Date.parse(`${value}:00:00Z`);
  return Number.isNaN(t) ? null : t;
}

function paged(req: SimRequest, route: string, key: string, records: unknown[], envelope: object): SimResponse {
  const size = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(req.query.get("page[size]")) || DEFAULT_PAGE_SIZE));
  const last = Math.max(1, Math.ceil(records.length / size));
  const page = Math.min(last, Math.max(1, Number(req.query.get("page[number]")) || 1));
  const link = (n: number) => {
    const q = new URLSearchParams(req.query);
    q.set("page[number]", String(n));
    q.set("page[size]", String(size));
    return `${req.baseUrl}${route}?${q}`;
  };
  return json(
    200,
    {
      ...envelope,
      [key]: records.slice((page - 1) * size, page * size),
      links: { first: link(1), last: link(last), prev: page > 1 ? link(page - 1) : null, next: page < last ? link(page + 1) : null },
    },
    MDS_JSON,
  );
}

function mds(req: SimRequest, op: OperatorProfile, endpoint: string): SimResponse {
  if (req.headers.authorization !== `Bearer ${op.token}`) {
    return mdsError(401, "unauthorized", "A valid bearer token is required.");
  }
  const accept = req.headers.accept ?? "";
  const asked = /application\/vnd\.mds\+(?:json|csv);\s*version=(\d+\.\d+)/.exec(accept)?.[1];
  if (asked && asked !== MDS_VERSION.slice(0, 3)) {
    return json(406, { error: "unsupported_version", error_description: `This API serves MDS ${MDS_VERSION}.`, supported_versions: [MDS_VERSION] }, MDS_JSON);
  }

  const { seed, now } = req;
  const route = `/${op.slug}/mds/${endpoint}`;
  const version = { version: MDS_VERSION };

  switch (endpoint) {
    case "vehicles":
      return paged(req, route, "vehicles", vehicles(seed, op), realtimeEnvelope(now));
    case "vehicles/status": {
      const t = realtimeInstant(seed, op, now);
      return paged(req, route, "vehicles_status", vehiclesStatus(seed, op, t), realtimeEnvelope(t));
    }
    case "stops": {
      const t = realtimeInstant(seed, op, now);
      return json(200, { ...realtimeEnvelope(t), stops: stops(seed, op, t) }, MDS_JSON);
    }
    case "trips":
    case "telemetry":
    case "events/historical": {
      const param = endpoint === "trips" ? "end_time" : endpoint === "telemetry" ? "telemetry_time" : "event_time";
      const hour = parseHour(req.query.get(param));
      if (hour === null) return mdsError(400, "bad_param", `${param} is required, as YYYY-MM-DDTHH (UTC).`);
      if (hour > now) return mdsError(404, "not_found", "That hour is in the future.");
      // An hour is published once it is over and has had a few minutes to settle.
      if (hour + HOUR_MS + 5 * 60_000 > now) return { ...mdsError(202, "not_ready", "Data for that hour is still being prepared."), body: "" };
      if (endpoint === "trips") return json(200, { ...version, trips: tripsEndedBetween(seed, op, hour, hour + HOUR_MS) }, MDS_JSON);
      if (endpoint === "telemetry") return json(200, { ...version, telemetry: telemetryBetween(seed, op, hour, hour + HOUR_MS) }, MDS_JSON);
      return json(200, { ...version, events: eventsBetween(seed, op, hour, hour + HOUR_MS) }, MDS_JSON);
    }
    case "events/recent": {
      const start = Number(req.query.get("start_time"));
      const end = Number(req.query.get("end_time"));
      if (!Number.isFinite(start) || !Number.isFinite(end) || !req.query.get("start_time") || !req.query.get("end_time") || end <= start) {
        return mdsError(400, "bad_param", "start_time and end_time are required, in milliseconds.");
      }
      if (start < now - TWO_WEEKS_MS) return mdsError(400, "bad_param", "start_time may be at most two weeks ago.");
      // A stuck feed stops publishing new events too.
      const t = realtimeInstant(seed, op, now);
      return paged(req, route, "events", eventsBetween(seed, op, start, Math.min(end, t)), version);
    }
  }

  const report = /^reports\/(\d{4}-\d{2})\.csv$/.exec(endpoint);
  if (report) {
    const month = report[1]!;
    if (month >= localTime(now).date.slice(0, 7)) return mdsError(404, "not_found", "Reports are published after the month ends.");
    return { status: 200, contentType: `text/vnd.mds+csv;version=${MDS_VERSION.slice(0, 3)}`, body: monthlyReportCsv(seed, op, month), delayMs: 0 };
  }
  return mdsError(404, "not_found", "No such endpoint.");
}

function index(req: SimRequest): SimResponse {
  return json(200, {
    notice: "Simulated feeds for a demonstration. The operators are fictional and no real vehicles or riders are described.",
    operators: OPERATORS.map((op) => ({
      name: op.name,
      gbfs: `${req.baseUrl}/${op.slug}/gbfs/3.0/gbfs.json`,
      mds: `${req.baseUrl}/${op.slug}/mds`,
      mds_token: op.token,
    })),
  });
}

export function handleSimRequest(req: SimRequest): SimResponse {
  const parts = req.path.replace(/\/+$/, "").split("/").filter(Boolean);
  if (parts.length === 0) return index(req);
  const op = operatorBySlug(parts[0]!);
  if (!op) return json(404, { error: "not_found" });

  const condition = feedCondition(req.seed, op, req.now);
  if (condition.outage) {
    return { status: 503, contentType: "text/plain", body: "Service temporarily unavailable\n", delayMs: 0 };
  }

  let response: SimResponse;
  if (parts[1] === "gbfs" && parts[2] === "3.0" && parts[3]?.endsWith(".json")) {
    const name = parts[3].slice(0, -5);
    const base = `${req.baseUrl}/${op.slug}/gbfs/3.0`;
    if (name === "gbfs") {
      response = json(200, discovery(op, req.now, base));
    } else if ((feedsFor(op) as string[]).includes(name)) {
      const realtime = name === "vehicle_status" || name === "station_status";
      response = json(200, gbfsFeed(req.seed, op, name as GbfsFeed, realtime ? (condition.frozenAt ?? req.now) : req.now));
    } else {
      response = json(404, { error: "not_found" });
    }
  } else if (parts[1] === "mds") {
    response = mds(req, op, parts.slice(2).join("/"));
  } else {
    response = json(404, { error: "not_found" });
  }
  response.delayMs = condition.delayMs;
  return response;
}
