// Data health: how well each operator's feeds are behaving, from the record of every request made to them.

import type { Actor } from "@mm/core/access";
import { healthScore, SLOW_MS, type Health, type HealthCounts } from "@mm/core/health";
import { authorize } from "./guard";
import { sql, sqlNow } from "./db";

export type FeedRow = {
  feed: string;
  polls: number;
  failed: number;
  slow: number;
  medianMs: number | null;
  records: number;
  invalid: number;
  incomplete: number;
  stale: number;
  realtime: number;
  lastPolled: number;
  lastOutcome: string;
  checkedAgainst: string | null;
};

export type ErrorGroup = {
  feed: string;
  path: string;
  keyword: string;
  message: string;
  count: number;
  lastSeen: number;
  sampleId: string | null;
  sampleMessage: string;
  sample: unknown;
};

export type OperatorHealth = {
  slug: string;
  name: string;
  health: Health;
  counts: HealthCounts;
  daily: { date: string; score: number | null }[];
  feeds: FeedRow[];
  errors: ErrorGroup[];
  outages: { from: number; to: number; polls: number }[];
};

export const counts = (r: Record<string, unknown>): HealthCounts => ({
  polls: Number(r.polls),
  failedPolls: Number(r.failed),
  slowPolls: Number(r.slow),
  realtimePolls: Number(r.realtime),
  stalePolls: Number(r.stale),
  records: Number(r.records),
  invalidRecords: Number(r.invalid),
  incompleteRecords: Number(r.incomplete),
});

export const MEASURES = sql`
  count(*)::int as polls,
  count(*) filter (where outcome <> 'ok')::int as failed,
  count(*) filter (where outcome = 'ok' and latency_ms > ${SLOW_MS})::int as slow,
  count(*) filter (where data_age_ms is not null)::int as realtime,
  count(*) filter (where stale)::int as stale,
  coalesce(sum(record_count), 0)::bigint as records,
  coalesce(sum(invalid_count), 0)::bigint as invalid,
  coalesce(sum(incomplete_count), 0)::bigint as incomplete`;

export async function dataHealth(actor: Actor, days: number): Promise<{ days: number; operators: OperatorHealth[] }> {
  const window = [1, 7, 14].includes(days) ? days : 7;
  const scope = await authorize(actor, "health.view", { action: "read", resource: "data_health", detail: { days: window } });
  const mine = scope ? sql`operator_id = ${scope}` : sql`true`;
  const since = sql`${sqlNow()} - make_interval(days => ${window})`;

  const [operators, totals, daily, feeds, errors, failures] = await Promise.all([
    sql`select id, slug, name from operators where ${scope ? sql`id = ${scope}` : sql`true`} order by name`,
    sql`select operator_id, ${MEASURES} from feed_polls where polled_at > ${since} and ${mine} group by 1`,
    sql`select operator_id, to_char(polled_at at time zone 'America/Denver', 'YYYY-MM-DD') as date, ${MEASURES}
      from feed_polls where polled_at > ${sqlNow()} - interval '14 days' and ${mine} group by 1, 2 order by 2`,
    sql`select operator_id, feed, ${MEASURES},
        (percentile_cont(0.5) within group (order by latency_ms) filter (where outcome = 'ok'))::int as median_ms,
        max(polled_at) as last_polled, (array_agg(outcome order by polled_at desc))[1] as last_outcome, max(checked_against) as checked_against
      from feed_polls where polled_at > ${since} and ${mine} group by 1, 2 order by 2`,
    sql`select operator_id, feed, path, keyword, message, sum(count)::int as count, max(seen_at) as last_seen,
        (array_agg(sample_record_id order by seen_at desc))[1] as sample_id, (array_agg(sample_message order by seen_at desc))[1] as sample_message,
        (array_agg(sample_record order by seen_at desc))[1] as sample
      from schema_errors where seen_at > ${since} and ${mine} group by 1, 2, 3, 4, 5 order by 6 desc`,
    sql`select operator_id, polled_at from feed_polls where polled_at > ${since} and outcome <> 'ok' and ${mine} order by 1, 2`,
  ]);

  return {
    days: window,
    operators: operators.map((o) => {
      const total = totals.find((t) => t.operator_id === o.id);
      const c = total ? counts(total) : counts({ polls: 0, failed: 0, slow: 0, realtime: 0, stale: 0, records: 0, invalid: 0, incomplete: 0 });
      // Failed requests less than half an hour apart are one outage.
      const outages: OperatorHealth["outages"] = [];
      for (const f of failures.filter((x) => x.operator_id === o.id)) {
        const at = f.polled_at.getTime();
        const last = outages.at(-1);
        if (last && at - last.to < 30 * 60_000) {
          last.to = at;
          last.polls++;
        } else outages.push({ from: at, to: at, polls: 1 });
      }
      return {
        slug: o.slug,
        name: o.name,
        health: healthScore(c),
        counts: c,
        daily: daily.filter((d) => d.operator_id === o.id).map((d) => ({ date: d.date as string, score: healthScore(counts(d)).score })),
        feeds: feeds
          .filter((f) => f.operator_id === o.id)
          .map((f) => ({
            feed: f.feed, polls: f.polls, failed: f.failed, slow: f.slow, medianMs: f.median_ms, records: Number(f.records), invalid: Number(f.invalid),
            incomplete: Number(f.incomplete), stale: f.stale, realtime: f.realtime, lastPolled: f.last_polled.getTime(), lastOutcome: f.last_outcome, checkedAgainst: f.checked_against,
          })),
        errors: errors
          .filter((e) => e.operator_id === o.id)
          .map((e) => ({ feed: e.feed, path: e.path, keyword: e.keyword, message: e.message, count: e.count, lastSeen: e.last_seen.getTime(), sampleId: e.sample_id, sampleMessage: e.sample_message, sample: e.sample })),
        outages: outages.reverse(),
      };
    }),
  };
}
