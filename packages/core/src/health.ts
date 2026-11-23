// Data health score for an operator's feeds: one number from 0 to 100, built
// from four measurements a city can check for itself.

export type HealthCounts = {
  /** Requests made to the operator's feeds. */
  polls: number;
  /** Requests that got no usable answer: server error, timeout, or a broken envelope. */
  failedPolls: number;
  /** Answered requests that took longer than SLOW_MS. */
  slowPolls: number;
  /** Requests to live feeds (the ones that state when they were last updated). */
  realtimePolls: number;
  /** Live-feed answers whose data was older than the feed's own stated lifetime. */
  stalePolls: number;
  records: number;
  /** Records that failed the official schema. */
  invalidRecords: number;
  /** Valid records missing an optional field the city relies on, such as battery level. */
  incompleteRecords: number;
};

export const SLOW_MS = 2000;
/** How long past its stated lifetime live data may be before it counts as stale. */
export const STALE_GRACE_MS = 120_000;

export type HealthComponent = {
  key: "uptime" | "latency" | "records" | "freshness";
  label: string;
  /** What was measured, as a share from 0 to 1. Null when there is nothing to measure yet. */
  rate: number | null;
  /** The rate at or below which the component scores zero. */
  floor: number;
  weight: number;
  score: number | null;
};

export type Health = {
  score: number | null;
  grade: "good" | "fair" | "poor" | "no_data";
  components: HealthComponent[];
};

const share = (good: number, total: number) => (total > 0 ? good / total : null);

/** A rate of 1 scores 100; the floor scores 0; straight line between. */
function scale(rate: number | null, floor: number): number | null {
  if (rate === null) return null;
  return Math.round(Math.max(0, Math.min(1, (rate - floor) / (1 - floor))) * 100);
}

export function healthScore(c: HealthCounts): Health {
  const answered = c.polls - c.failedPolls;
  const measured: Omit<HealthComponent, "score">[] = [
    { key: "uptime", label: "Uptime", rate: share(answered, c.polls), floor: 0.95, weight: 30 },
    { key: "latency", label: "Response time", rate: share(answered - c.slowPolls, answered), floor: 0.8, weight: 15 },
    { key: "records", label: "Complete, valid records", rate: share(c.records - c.invalidRecords - c.incompleteRecords, c.records), floor: 0.9, weight: 35 },
    { key: "freshness", label: "Fresh data", rate: share(c.realtimePolls - c.stalePolls, c.realtimePolls), floor: 0.9, weight: 20 },
  ];
  const components = measured.map((m) => ({ ...m, score: scale(m.rate, m.floor) }));
  const scored = components.filter((x) => x.score !== null);
  if (scored.length === 0) return { score: null, grade: "no_data", components };
  const weight = scored.reduce((sum, x) => sum + x.weight, 0);
  const score = Math.round(scored.reduce((sum, x) => sum + x.score! * x.weight, 0) / weight);
  return { score, grade: score >= 90 ? "good" : score >= 70 ? "fair" : "poor", components };
}
