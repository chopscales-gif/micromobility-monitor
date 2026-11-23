// The city's rules for shared vehicles, and the arithmetic that decides whether
// one was broken. Pure functions: status changes, zones and settings go in,
// measurements and their evidence come out. Nothing here reads a database.

import { distanceMeters, pointInPolygon, type LngLat, type Polygon } from "./geo";

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

// --- The rules and their settings ---------------------------------------------

export const RULE_KINDS = ["fleet_cap", "equity_minimum", "parking_dwell", "rebalancing_sla", "slow_zone_speed"] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

export type RuleParams = {
  fleet_cap: { graceMinutes: number };
  equity_minimum: { minSharePct: number; checkHour: number };
  parking_dwell: { limitHours: number };
  rebalancing_sla: { hours: number; dailyAllowance: number };
  slow_zone_speed: { toleranceKph: number; maxSharePct: number };
};

export type ParamSpec = { key: string; label: string; unit: string; min: number; max: number; whole: boolean };

export const RULES: { [K in RuleKind]: { label: string; defaults: RuleParams[K]; params: ParamSpec[] } } = {
  fleet_cap: {
    label: "Fleet cap",
    defaults: { graceMinutes: 60 },
    params: [{ key: "graceMinutes", label: "Time over the cap before it counts", unit: "minutes", min: 0, max: 720, whole: true }],
  },
  equity_minimum: {
    label: "Equity zone minimum",
    defaults: { minSharePct: 10, checkHour: 7 },
    params: [
      { key: "minSharePct", label: "Share of available vehicles that must be in equity zones", unit: "%", min: 1, max: 60, whole: false },
      { key: "checkHour", label: "Hour of the morning count (0 to 23)", unit: "h", min: 0, max: 23, whole: true },
    ],
  },
  parking_dwell: {
    label: "Parking dwell limit",
    defaults: { limitHours: 72 },
    params: [{ key: "limitHours", label: "Longest a vehicle may stay in one spot", unit: "hours", min: 12, max: 336, whole: true }],
  },
  rebalancing_sla: {
    label: "Rebalancing deadline",
    defaults: { hours: 4, dailyAllowance: 5 },
    params: [
      { key: "hours", label: "Time allowed to move a badly parked vehicle", unit: "hours", min: 0.5, max: 24, whole: false },
      { key: "dailyAllowance", label: "Missed deadlines tolerated per day", unit: "vehicles", min: 0, max: 100, whole: true },
    ],
  },
  slow_zone_speed: {
    label: "Slow zone speed",
    defaults: { toleranceKph: 2, maxSharePct: 2 },
    params: [
      { key: "toleranceKph", label: "Margin above the posted limit", unit: "km/h", min: 0, max: 10, whole: false },
      { key: "maxSharePct", label: "Share of rides allowed over the limit", unit: "%", min: 0, max: 50, whole: false },
    ],
  },
};

/** Checks settings typed into a form. Returns the cleaned settings, or the first problem in plain words. */
export function checkParams<K extends RuleKind>(kind: K, input: Record<string, unknown>): { ok: true; params: RuleParams[K] } | { ok: false; problem: string } {
  const params: Record<string, number> = {};
  for (const spec of RULES[kind].params) {
    const raw = input[spec.key];
    const text = typeof raw === "number" ? String(raw) : String(raw ?? "").trim();
    if (!/^\d+(\.\d)?$/.test(text)) return { ok: false, problem: `"${spec.label}" must be a number${spec.whole ? "" : " with at most one decimal place"}.` };
    const value = Number(text);
    if (spec.whole && !Number.isInteger(value)) return { ok: false, problem: `"${spec.label}" must be a whole number.` };
    if (value < spec.min || value > spec.max) return { ok: false, problem: `"${spec.label}" must be between ${spec.min} and ${spec.max}.` };
    params[spec.key] = value;
  }
  return { ok: true, params: params as RuleParams[K] };
}

// --- What the rules read --------------------------------------------------------

/** One MDS status change, as stored. Lists passed to the functions below are in time order. */
export type StatusChange = { deviceId: string; ts: number; state: string; lng: number; lat: number };

export type RuleZone = {
  id: string;
  name: string;
  type: string;
  polygons: Polygon[];
  speedLimitKph: number | null;
  effectiveFrom: number;
  retiredAt: number | null;
};

/** A zone binds from the moment it was adopted until it is retired; it is never applied to what came before. */
export const zoneInForce = (zone: RuleZone, at: number) => zone.effectiveFrom <= at && (zone.retiredAt === null || zone.retiredAt > at);
const inZone = (zone: RuleZone, point: LngLat) => zone.polygons.some((polygon) => pointInPolygon(point, polygon));

/** In the public right of way inside the city: these count against the fleet cap. */
export const ON_STREET_STATES = ["available", "non_operational", "reserved", "on_trip"] as const;
const ON_STREET = new Set<string>(ON_STREET_STATES);
/** Standing still somewhere, rather than being ridden or in the operator's hands. */
export const PARKED_STATES = ["available", "non_operational", "reserved", "elsewhere"] as const;
const PARKED = new Set<string>(PARKED_STATES);

// --- Fleet cap ------------------------------------------------------------------

/** The number of vehicles on the street after each status change that altered it. */
export function fleetCounts(events: StatusChange[]): [ts: number, onStreet: number][] {
  const onStreet = new Map<string, boolean>();
  const steps: [number, number][] = [];
  let count = 0;
  for (const e of events) {
    const now = ON_STREET.has(e.state);
    if ((onStreet.get(e.deviceId) ?? false) === now) continue;
    onStreet.set(e.deviceId, now);
    count += now ? 1 : -1;
    const last = steps[steps.length - 1];
    if (last && last[0] === e.ts) last[1] = count;
    else steps.push([e.ts, count]);
  }
  return steps;
}

export type FleetCapEvidence = {
  permitted: number;
  peak: number;
  peakAt: number;
  minutesOver: number;
  longestRunMinutes: number;
  /** The most vehicles on the street in each hour of the day. */
  hourly: number[];
};

/**
 * One day against the cap. `breachedAt` is the moment the fleet had been over the cap for the
 * whole grace period (null if it never was); a brief overshoot while crews swap vehicles is not a breach.
 */
export function capDay(steps: [number, number][], day: { start: number; end: number }, permitted: number, graceMinutes: number, now = day.end): FleetCapEvidence & { breachedAt: number | null } {
  const end = Math.min(day.end, now);
  const hourly: number[] = Array.from({ length: Math.max(1, Math.ceil((end - day.start) / HOUR_MS)) }, () => 0);
  let count = 0;
  let i = 0;
  while (i < steps.length && steps[i]![0] <= day.start) count = steps[i++]![1];

  let peak = count;
  let peakAt = day.start;
  let overMs = 0;
  let longestMs = 0;
  let breachedAt: number | null = null;
  let runStart: number | null = count > permitted ? day.start : null;
  let cursor = day.start;

  const advance = (to: number) => {
    // The count held from `cursor` to `to`.
    for (let h = Math.floor((cursor - day.start) / HOUR_MS); h < hourly.length && day.start + h * HOUR_MS < to; h++) hourly[h] = Math.max(hourly[h]!, count);
    if (count > permitted) {
      overMs += to - cursor;
      longestMs = Math.max(longestMs, to - runStart!);
      if (breachedAt === null && to - runStart! >= graceMinutes * MINUTE_MS) breachedAt = runStart! + graceMinutes * MINUTE_MS;
    }
    cursor = to;
  };

  for (; i < steps.length && steps[i]![0] < end; i++) {
    const [ts, next] = steps[i]!;
    advance(ts);
    if (next > permitted && count <= permitted) runStart = ts;
    if (next <= permitted) runStart = null;
    count = next;
    if (count > peak) {
      peak = count;
      peakAt = ts;
    }
  }
  if (end > cursor) advance(end);
  return { permitted, peak, peakAt, minutesOver: Math.round(overMs / MINUTE_MS), longestRunMinutes: Math.round(longestMs / MINUTE_MS), hourly, breachedAt };
}

// --- Equity distribution --------------------------------------------------------

/** Each vehicle's latest status at each of the given moments (which must be in order). */
export function fleetAt(events: StatusChange[], times: number[]): Map<string, StatusChange>[] {
  const latest = new Map<string, StatusChange>();
  const snapshots: Map<string, StatusChange>[] = [];
  let i = 0;
  for (const time of times) {
    while (i < events.length && events[i]!.ts <= time) {
      latest.set(events[i]!.deviceId, events[i]!);
      i++;
    }
    snapshots.push(new Map(latest));
  }
  return snapshots;
}

export type EquityDay = { date: string; available: number; inZones: number; sharePct: number | null };
export type EquityEvidence = { checkHour: number; days: EquityDay[]; zones: string[] };

/** Of the vehicles a rider could rent at this moment, how many stand inside an equity zone. */
export function equityCount(snapshot: Iterable<StatusChange>, zones: RuleZone[], at: number): { available: number; inZones: number } {
  const equity = zones.filter((z) => z.type === "equity" && zoneInForce(z, at));
  let available = 0;
  let inZones = 0;
  for (const v of snapshot) {
    if (v.state !== "available") continue;
    available++;
    if (equity.some((z) => inZone(z, [v.lng, v.lat]))) inZones++;
  }
  return { available, inZones };
}

/** The week's figure is the average of the daily shares, so one large morning cannot hide six thin ones. */
export function equityWeek(days: { date: string; available: number; inZones: number }[]): { sharePct: number; days: EquityDay[] } | null {
  const scored = days.map((d) => ({ ...d, sharePct: d.available > 0 ? round1((d.inZones / d.available) * 100) : null }));
  const counted = scored.filter((d) => d.sharePct !== null);
  if (counted.length === 0) return null;
  return { sharePct: round1(counted.reduce((sum, d) => sum + (d.inZones / d.available) * 100, 0) / counted.length), days: scored };
}

// --- Stays: a vehicle standing in one place ---------------------------------------

export type Stay = {
  deviceId: string;
  from: number;
  /** Null while the vehicle is still there. */
  to: number | null;
  lng: number;
  lat: number;
  /** The operator reported the vehicle as ridden out of the permitted area. */
  outside: boolean;
  lastState: string;
};

/** A vehicle reported twice within this distance has not been moved; GPS wanders by a few metres. */
const SAME_SPOT_METERS = 15;

/** Turns the stream of status changes into the periods each vehicle spent standing in one spot. */
export function buildStays(events: StatusChange[]): Stay[] {
  const open = new Map<string, Stay>();
  const stays: Stay[] = [];
  for (const e of events) {
    const current = open.get(e.deviceId);
    const parked = PARKED.has(e.state);
    if (current && parked && distanceMeters([current.lng, current.lat], [e.lng, e.lat]) <= SAME_SPOT_METERS) {
      current.outside ||= e.state === "elsewhere";
      current.lastState = e.state;
      continue;
    }
    if (current) {
      current.to = e.ts;
      open.delete(e.deviceId);
    }
    if (parked) {
      const stay: Stay = { deviceId: e.deviceId, from: e.ts, to: null, lng: e.lng, lat: e.lat, outside: e.state === "elsewhere", lastState: e.state };
      open.set(e.deviceId, stay);
      stays.push(stay);
    }
  }
  return stays;
}

export type MisparkReason = "outside_area" | "no_ride" | "no_parking";

/** Why a vehicle may not stand where it is, judged by the zones in force when it was left there. */
export function misparked(stay: Stay, zones: RuleZone[]): { reason: MisparkReason; zone: string | null } | null {
  const point: LngLat = [stay.lng, stay.lat];
  const inForce = zones.filter((z) => zoneInForce(z, stay.from));
  const service = inForce.filter((z) => z.type === "service_area");
  if (stay.outside || (service.length > 0 && !service.some((z) => inZone(z, point)))) return { reason: "outside_area", zone: null };
  for (const reason of ["no_ride", "no_parking"] as const) {
    const zone = inForce.find((z) => z.type === reason && inZone(z, point));
    if (zone) return { reason, zone: zone.name };
  }
  return null;
}

export type SlaBreach = { stay: Stay; reason: MisparkReason; zone: string | null; breachAt: number; hours: number };

/** Badly parked vehicles the operator did not move within the deadline. */
export function slaBreaches(stays: Stay[], zones: RuleZone[], hours: number, now: number): SlaBreach[] {
  const breaches: SlaBreach[] = [];
  for (const stay of stays) {
    const lasted = (stay.to ?? now) - stay.from;
    if (lasted <= hours * HOUR_MS) continue;
    const why = misparked(stay, zones);
    if (why) breaches.push({ stay, ...why, breachAt: stay.from + hours * HOUR_MS, hours: round1(lasted / HOUR_MS) });
  }
  return breaches;
}

/** Vehicles left in one spot for longer than the dwell limit, wherever that spot is. */
export function dwellBreaches(stays: Stay[], limitHours: number, now: number): { stay: Stay; breachAt: number; hours: number }[] {
  return stays
    .filter((stay) => (stay.to ?? now) - stay.from > limitHours * HOUR_MS)
    .map((stay) => ({ stay, breachAt: stay.from + limitHours * HOUR_MS, hours: round1(((stay.to ?? now) - stay.from) / HOUR_MS) }));
}

export type SlaVehicle = { deviceId: string; code: string; reason: MisparkReason; zone: string | null; lng: number; lat: number; parkedAt: number; movedAt: number | null; hours: number };
export type SlaEvidence = { hours: number; total: number; byReason: Record<MisparkReason, number>; vehicles: SlaVehicle[] };
export type DwellEvidence = { code: string; vehicleType: string; lng: number; lat: number; parkedAt: number; movedAt: number | null; hours: number; lastState: string; misparked: MisparkReason | null; zone: string | null };

// --- Slow zones -----------------------------------------------------------------

/** A gap in a pass's readings: the rider left the zone and came back, or a point arrived without a speed. */
export const SPEED_GAP = -1;

export type RoutePoint = [timestamp: number, lng: number, lat: number, speedMps: number | null];
export type ZonePass = { zoneId: string; enteredAt: number; limitKph: number; speeds: number[] };

/** The speed readings a ride produced inside each slow zone it passed through, in km/h. */
export function zonePasses(path: RoutePoint[], zones: RuleZone[]): ZonePass[] {
  const passes = new Map<string, ZonePass & { lastIndex: number }>();
  path.forEach(([ts, lng, lat, speed], index) => {
    for (const zone of zones) {
      if (zone.type !== "slow_ride" || zone.speedLimitKph === null || !zoneInForce(zone, ts) || !inZone(zone, [lng, lat])) continue;
      const reading = speed === null ? SPEED_GAP : round1(speed * 3.6);
      const pass = passes.get(zone.id);
      if (!pass) {
        passes.set(zone.id, { zoneId: zone.id, enteredAt: ts, limitKph: zone.speedLimitKph, speeds: [reading], lastIndex: index });
      } else {
        if (pass.lastIndex !== index - 1) pass.speeds.push(SPEED_GAP);
        pass.speeds.push(reading);
        pass.lastIndex = index;
      }
    }
  });
  return [...passes.values()].map(({ lastIndex: _, ...pass }) => pass);
}

/**
 * Whether a pass was ridden over the limit. One fast reading is not enough: a vehicle that
 * slows itself down still reports its approach speed as it crosses the line, so the test is
 * two readings in a row above the limit plus the margin.
 */
export function overLimit(speeds: number[], limitKph: number, toleranceKph: number): { sustained: boolean; readingsOver: number; maxKph: number } {
  let run = 0;
  let sustained = false;
  let readingsOver = 0;
  let maxKph = 0;
  for (const speed of speeds) {
    maxKph = Math.max(maxKph, speed);
    if (speed > limitKph + toleranceKph) {
      readingsOver++;
      if (++run >= 2) sustained = true;
    } else run = 0;
  }
  return { sustained, readingsOver, maxKph };
}

/** Fewer rides than this through the slow zones in a day says nothing reliable about an operator. */
export const MIN_PASSES_TO_JUDGE = 20;

export type SpeedPass = ZonePass & { tripId: string; deviceId: string };
export type SpeedEvidence = {
  passes: number;
  speeding: number;
  toleranceKph: number;
  zones: { zoneId: string; limitKph: number; passes: number; speeding: number }[];
  /** The fastest passes of the day, for follow-up with the operator. */
  worst: { tripId: string; deviceId: string; zoneId: string; enteredAt: number; maxKph: number; readingsOver: number; readings: number }[];
};

/** One operator's day in the slow zones. Null when there were too few rides to judge. */
export function speedDay(passes: SpeedPass[], toleranceKph: number): (SpeedEvidence & { sharePct: number }) | null {
  if (passes.length < MIN_PASSES_TO_JUDGE) return null;
  const zones = new Map<string, SpeedEvidence["zones"][number]>();
  const worst: SpeedEvidence["worst"] = [];
  let speeding = 0;
  for (const pass of passes) {
    const zone = zones.get(pass.zoneId) ?? { zoneId: pass.zoneId, limitKph: pass.limitKph, passes: 0, speeding: 0 };
    zones.set(pass.zoneId, zone);
    zone.passes++;
    const result = overLimit(pass.speeds, pass.limitKph, toleranceKph);
    if (!result.sustained) continue;
    zone.speeding++;
    speeding++;
    worst.push({ tripId: pass.tripId, deviceId: pass.deviceId, zoneId: pass.zoneId, enteredAt: pass.enteredAt, maxKph: result.maxKph, readingsOver: result.readingsOver, readings: pass.speeds.filter((s) => s !== SPEED_GAP).length });
  }
  worst.sort((a, b) => b.maxKph - a.maxKph || b.readingsOver - a.readingsOver || a.enteredAt - b.enteredAt);
  return { passes: passes.length, speeding, sharePct: round1((speeding / passes.length) * 100), toleranceKph, zones: [...zones.values()], worst: worst.slice(0, 12) };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
