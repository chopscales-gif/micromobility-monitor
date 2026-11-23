// One request to one feed: fetch it, check it against the official schema, and
// write down what happened. Everything the health score knows comes from here.

import { STALE_GRACE_MS, validateFeed, type FeedId, type FeedValidation, type InvalidRecord } from "@mm/core";
import { insertRows, type FetchResult, type IngestContext, type Operator } from "./context";

export type PollOutcome = "ok" | "http_error" | "network_error" | "not_json" | "envelope_invalid";

export type Poll<T> = {
  outcome: PollOutcome | "not_ready";
  /** Records that passed validation. Empty unless the outcome is "ok". */
  records: T[];
  /** The parsed response, when there was one. */
  body: Record<string, unknown> | null;
  /** Usable = an answer arrived and its envelope was sound. */
  usable: boolean;
};

/** Feeds that describe the present moment and say when they were last updated. */
const LIVE_FEEDS: Partial<Record<FeedId, "gbfs" | "mds">> = {
  "gbfs.vehicle_status": "gbfs",
  "gbfs.station_status": "gbfs",
  "mds.vehicles_status": "mds",
  "mds.stops": "mds",
};

/** Optional fields the city relies on. A valid record without them is counted as incomplete. */
const EXPECTED: Partial<Record<FeedId, (record: Record<string, unknown>) => boolean>> = {
  "mds.events_recent": (r) => typeof r.battery_percent === "number",
  "mds.events_historical": (r) => typeof r.battery_percent === "number",
  "mds.telemetry": (r) => typeof r.battery_percent === "number",
};

const mdsHeaders = (op: Operator) => ({ authorization: `Bearer ${op.token}`, accept: "application/vnd.mds+json;version=2.1" });

function dataAge(feed: FeedId, body: Record<string, unknown>, now: number): { ageMs: number; stale: boolean } | null {
  const kind = LIVE_FEEDS[feed];
  if (!kind) return null;
  const updated = kind === "mds" ? Number(body.last_updated) : Date.parse(String(body.last_updated));
  const ttlMs = kind === "mds" ? Number(body.ttl) : Number(body.ttl) * 1000;
  if (!Number.isFinite(updated) || !Number.isFinite(ttlMs)) return null;
  const ageMs = Math.max(0, now - updated);
  return { ageMs, stale: ageMs > ttlMs + STALE_GRACE_MS };
}

type ErrorGroup = { path: string; keyword: string; message: string; count: number; sample: InvalidRecord };

/** "must be integer (got "x")" and "must be integer (got "y")" are the same fault. */
function groupErrors(invalid: InvalidRecord[]): ErrorGroup[] {
  const groups = new Map<string, ErrorGroup>();
  for (const record of invalid) {
    const first = record.issues[0];
    if (!first) continue;
    const message = first.message.replace(/ \(got .*\)$/s, "");
    const key = `${first.path}|${first.keyword}|${message}`;
    const group = groups.get(key);
    if (group) group.count++;
    else groups.set(key, { path: first.path, keyword: first.keyword, message, count: 1, sample: record });
  }
  return [...groups.values()];
}

/**
 * Fetches a feed (following MDS page links), validates it and records the poll.
 * `periodHour` marks an hourly file; a 202 for one means "not published yet" and is not recorded.
 */
export async function pollFeed<T = Record<string, unknown>>(
  ctx: IngestContext,
  op: Operator,
  feed: FeedId,
  url: string,
  options: { periodHour?: number } = {},
): Promise<Poll<T>> {
  const headers = feed.startsWith("mds.") ? mdsHeaders(op) : {};
  const polledAt = ctx.now();
  let latencyMs = 0;
  let status = 0;
  let outcome: PollOutcome = "ok";
  let first: Record<string, unknown> | null = null;
  let validation: FeedValidation<T> | null = null;
  const valid: T[] = [];
  const invalid: InvalidRecord[] = [];
  let recordCount = 0;

  let next: string | null = url;
  for (let page = 0; next && page < 50; page++) {
    const result: FetchResult = await ctx.fetch(next, headers);
    latencyMs = Math.max(latencyMs, result.latencyMs);
    status = result.status;
    if (result.status === 202 && options.periodHour !== undefined) return { outcome: "not_ready", records: [], body: null, usable: false };
    if (result.status === 0) outcome = "network_error";
    else if (result.status !== 200) outcome = "http_error";
    if (outcome !== "ok") break;

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(result.body);
    } catch {
      outcome = "not_json";
      break;
    }
    first ??= body;
    validation = validateFeed<T>(feed, body);
    if (validation.envelopeIssues.length > 0) {
      outcome = "envelope_invalid";
      break;
    }
    recordCount += validation.recordCount;
    for (const r of validation.validRecords) valid.push(r);
    for (const r of validation.invalidRecords) invalid.push(r);
    const links = body.links as { next?: string | null } | undefined;
    next = links?.next ?? null;
  }

  const expected = EXPECTED[feed];
  const incomplete = expected ? valid.filter((r) => !expected(r as Record<string, unknown>)).length : 0;
  const age = outcome === "ok" && first ? dataAge(feed, first, polledAt) : null;

  const [poll] = await ctx.sql`
    insert into feed_polls (operator_id, feed, polled_at, period_hour, status_code, outcome, latency_ms, record_count, invalid_count, incomplete_count, data_age_ms, stale, checked_against, envelope_issues)
    values (${op.id}, ${feed}, ${new Date(polledAt)}, ${options.periodHour === undefined ? null : new Date(options.periodHour)}, ${status || null}, ${outcome}, ${latencyMs},
      ${recordCount}, ${invalid.length}, ${incomplete}, ${age?.ageMs ?? null}, ${age?.stale ?? false}, ${validation?.checkedAgainst ?? null},
      ${outcome === "envelope_invalid" && validation ? ctx.sql.json(validation.envelopeIssues) : null})
    returning id`;

  await insertRows(
    ctx.sql,
    "schema_errors",
    groupErrors(invalid).map((group) => ({
      poll_id: poll!.id,
      operator_id: op.id,
      feed,
      seen_at: new Date(polledAt),
      path: group.path,
      keyword: group.keyword,
      message: group.message,
      count: group.count,
      sample_record_id: group.sample.recordId,
      sample_message: group.sample.issues[0]!.message,
      sample_record: group.sample.record,
    })),
    "",
  );

  return { outcome, records: outcome === "ok" ? valid : [], body: first, usable: outcome === "ok" };
}
