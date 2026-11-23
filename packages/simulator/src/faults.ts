// Deliberate faults in the feeds, so the city-side validation and data health
// scoring have something real to catch. Like everything else in the simulator,
// faults are a pure function of (seed, operator, time): the same outage happens
// at the same minute however many times the feed is read.

import { rng } from "./random";
import { HOUR_MS } from "./time";
import type { OperatorProfile } from "./world";

const MINUTE_MS = 60_000;

export type FeedCondition = {
  /** The API is down: requests get a 503. */
  outage: boolean;
  /** The realtime feeds are stuck, still serving the picture from this instant. */
  frozenAt: number | null;
  /** Extra time the server takes to answer. */
  delayMs: number;
};

const PROFILE = {
  clean: { outagesPer6h: 0, outageMinutes: [0, 0], freezeChancePerDay: 0, slowShare: 0, brokenRecords: 0, missingOptional: 0 },
  minor: { outagesPer6h: 0.12, outageMinutes: [3, 6], freezeChancePerDay: 0, slowShare: 0.02, brokenRecords: 0.004, missingOptional: 0.002 },
  poor: { outagesPer6h: 0.9, outageMinutes: [6, 16], freezeChancePerDay: 0.8, slowShare: 0.12, brokenRecords: 0.026, missingOptional: 0.04 },
} as const;

export function feedCondition(seed: string, op: OperatorProfile, t: number): FeedCondition {
  const profile = PROFILE[op.feedQuality];
  const condition: FeedCondition = { outage: false, frozenAt: null, delayMs: 0 };
  if (op.feedQuality === "clean") return condition;

  // Outages: at most one in each six-hour block.
  const block = Math.floor(t / (6 * HOUR_MS));
  const o = rng(seed, op.slug, "outage", block);
  if (o.chance(profile.outagesPer6h)) {
    const start = block * 6 * HOUR_MS + o.range(0, 5.5) * HOUR_MS;
    const length = o.range(profile.outageMinutes[0], profile.outageMinutes[1]) * MINUTE_MS;
    if (t >= start && t < start + length) condition.outage = true;
  }

  // Frozen feed: at most once a day, the realtime feeds stop moving for a while.
  const day = Math.floor(t / (24 * HOUR_MS));
  const f = rng(seed, op.slug, "freeze", day);
  if (f.chance(profile.freezeChancePerDay)) {
    const start = day * 24 * HOUR_MS + f.range(14, 23) * HOUR_MS; // daytime in Utah
    const length = f.range(18, 45) * MINUTE_MS;
    if (t >= start && t < start + length) condition.frozenAt = Math.floor(start);
  }

  // Slow answers, decided per five-minute stretch.
  const s = rng(seed, op.slug, "slow", Math.floor(t / (5 * MINUTE_MS)));
  if (s.chance(profile.slowShare)) condition.delayMs = Math.round(s.range(1200, 3800));

  return condition;
}

type Json = Record<string, any>;
export type RecordKind = "event" | "telemetry" | "trip" | "vehicle" | "gbfs_vehicle";

// Each entry is a mistake real feeds make.
const BREAKS: Record<RecordKind, ((r: Json) => void)[]> = {
  event: [
    (r) => delete r.event_types,
    (r) => (r.vehicle_state = "in_use"), // a state name from MDS 0.4
    (r) => (r.timestamp = new Date(r.timestamp).toISOString()), // text where a number belongs
    (r) => (r.location = { lat: String(r.location.lat), lng: String(r.location.lng) }),
    (r) => delete r.trip_ids,
    (r) => delete r.location,
  ],
  telemetry: [
    (r) => delete r.location.lng,
    (r) => (r.timestamp = Math.floor(r.timestamp / 1000)), // seconds instead of milliseconds
    (r) => (r.battery_percent = 104),
    (r) => delete r.journey_id,
  ],
  trip: [
    (r) => delete r.end_location,
    (r) => (r.duration = r.duration / 60), // minutes, with decimals
    (r) => (r.distance = -1),
    (r) => (r.trip_type = "ride"),
    (r) => (r.start_time = new Date(r.start_time).toISOString()),
  ],
  vehicle: [(r) => (r.propulsion_types = []), (r) => (r.vehicle_type = "e-scooter"), (r) => delete r.vehicle_id],
  gbfs_vehicle: [
    (r) => delete r.is_reserved,
    (r) => (r.lat = String(r.lat ?? "")),
    (r) => (r.current_fuel_percent = Math.round((r.current_fuel_percent ?? 0.5) * 100)), // 0-100 where 0-1 belongs
    (r) => (r.is_disabled = "false"),
  ],
};

/**
 * Possibly damages one record, the same way every time it is served.
 * Returns the record (damaged in place) so calls can be chained.
 */
export function withFaults<T extends Json>(seed: string, op: OperatorProfile, kind: RecordKind, id: string, record: T): T {
  const profile = PROFILE[op.feedQuality];
  if (profile.brokenRecords === 0) return record;
  const r = rng(seed, op.slug, "fault", kind, id);
  if (r.chance(profile.brokenRecords)) {
    const breaks = BREAKS[kind];
    let pick = breaks[r.int(0, breaks.length - 1)]!;
    // "missing trip id" only breaks a trip event; fall back to another fault otherwise.
    if (kind === "event" && pick === breaks[4] && !record.trip_ids) pick = breaks[0]!;
    pick(record);
  } else if (r.chance(profile.missingOptional) && "battery_percent" in record) {
    // Still valid against the schema, but a field the city relies on is gone.
    delete (record as Json).battery_percent;
  }
  return record;
}
