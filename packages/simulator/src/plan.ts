// Builds one operator's full service day: where every vehicle is put out in the
// morning, every ride, every crew visit, and the overnight collection.
//
// A day plan is a pure function of (seed, operator, date). Nothing is stored:
// the feeds for any instant are produced by replaying the plan up to that
// instant, which is what lets the hosted demo run without a background process.

import { rng, seededUuid, type Rng } from "./random";
import { addDays, HOUR_MS, serviceDayOf, serviceDayStart, weekdayOf } from "./time";
import {
  BLOCK_METERS,
  HOTSPOTS,
  inZone,
  OUT_OF_AREA_DESTINATIONS,
  SERVICE_AREA,
  zonesOfType,
  type GridPoint,
  type Hotspot,
  type OperatorProfile,
  type VehicleKind,
} from "./world";

const MINUTE_MS = 60_000;
const LOW_BATTERY = 15;
const TELEMETRY_STEP_MS = 20_000;

export type SimVehicle = {
  index: number;
  deviceId: string;
  /** The code printed on the vehicle, e.g. "KES-0412". */
  code: string;
  kind: VehicleKind;
  docked: boolean;
};

export type SimStation = { id: string; name: string; at: GridPoint; capacity: number };

export type SimEventKind =
  | "deploy" // crew puts the vehicle out in the morning
  | "trip_start"
  | "trip_leave_area" // rider crosses out of the permitted area
  | "trip_end"
  | "battery_low" // vehicle takes itself out of service
  | "battery_swap" // crew swaps the battery where the vehicle stands
  | "crew_pickup" // crew collects the vehicle (to move it, or for the night)
  | "crew_dropoff"; // crew puts a moved vehicle back out

export type CrewReason = "rebalance" | "recover" | "night";

export type SimEvent = {
  id: string;
  t: number;
  vehicle: number;
  kind: SimEventKind;
  at: GridPoint;
  battery: number;
  tripId?: string;
  reason?: CrewReason;
};

export type RoutePoint = { t: number; x: number; y: number; speed: number };

export type SimTrip = {
  id: string;
  vehicle: number;
  startT: number;
  endT: number;
  route: RoutePoint[];
  distanceM: number;
  startBattery: number;
  endBattery: number;
  endedOutsideArea: boolean;
};

/** "elsewhere" is a vehicle ridden out of the permitted area, moving or parked. */
export type VehicleState = "removed" | "available" | "on_trip" | "non_operational" | "elsewhere";

export type DayPlan = {
  operator: OperatorProfile;
  date: string;
  startT: number;
  endT: number;
  vehicles: SimVehicle[];
  stations: SimStation[];
  events: SimEvent[];
  eventsByVehicle: SimEvent[][];
  trips: SimTrip[];
  tripsById: Map<string, SimTrip>;
  /** Vehicles already on the street when the day begins (left out for days). */
  initial: Map<number, { at: GridPoint; battery: number }>;
};

// --- Roster and stations (stable across days) --------------------------------

const rosterCache = new Map<string, SimVehicle[]>();

export function roster(seed: string, op: OperatorProfile): SimVehicle[] {
  const key = `${seed}|${op.slug}`;
  let list = rosterCache.get(key);
  if (!list) {
    const prefix = op.slug.slice(0, 3).toUpperCase();
    list = Array.from({ length: op.scooters + op.bikes }, (_, index) => {
      const kind: VehicleKind = index < op.scooters ? "scooter" : "bicycle";
      return {
        index,
        deviceId: seededUuid(seed, op.slug, "vehicle", index),
        code: `${prefix}-${String(index + 1).padStart(4, "0")}`,
        kind,
        docked: kind === "bicycle" && op.stations > 0,
      };
    });
    rosterCache.set(key, list);
  }
  return list;
}

export function stations(seed: string, op: OperatorProfile): SimStation[] {
  if (op.stations === 0) return [];
  const ranked = [...HOTSPOTS]
    .filter((h) => !zonesOfType("no_parking").some((z) => inZone(h.at, z)))
    .sort((a, b) => b.work + b.leisure + b.campus + b.home - (a.work + a.leisure + a.campus + a.home))
    .slice(0, op.stations);
  return ranked.map((h, i) => ({
    id: seededUuid(seed, op.slug, "station", i),
    name: `${h.name} Station`,
    // Stations stand at the nearest street corner, just off the roadway.
    at: { x: Math.round(h.at.x) + 0.06, y: Math.round(h.at.y) + 0.06 },
    capacity: 14 + ((i * 7) % 9),
  }));
}

// --- Demand shape -------------------------------------------------------------

// Relative ride demand for each hour of the service day, 05:00 through 01:00.
const WEEKDAY_PROFILE = [0.2, 0.8, 2.2, 3.2, 2.2, 1.6, 2, 2.8, 2.4, 1.9, 2.2, 3, 3.6, 2.8, 2, 1.5, 1.1, 0.8, 0.5, 0.25, 0.1];
const WEEKEND_PROFILE = [0.05, 0.15, 0.4, 0.9, 1.5, 2.2, 2.8, 3.1, 3.2, 3.1, 2.9, 2.7, 2.4, 2.2, 1.9, 1.6, 1.3, 1.1, 0.8, 0.5, 0.25];
const DAY_OF_WEEK_FACTOR = [0.85, 1, 1, 1, 1, 1.15, 1.1];
const MONTH_FACTOR = [0.45, 0.5, 0.7, 0.9, 1.05, 1.1, 1.1, 1.1, 1.05, 0.95, 0.8, 0.55];
const RIDES_PER_VEHICLE = { scooter: 2.4, bicycle: 3 } as const;
const SPEED_MPS = { scooter: 4.3, bicycle: 5.1 } as const;
const GOVERNED_SPEED_MPS = 3.3; // about 12 km/h
const DRAIN_PCT_PER_KM = { scooter: 3.4, bicycle: 2.2 } as const;

type Purpose = "commute_in" | "commute_out" | "midday" | "leisure";

function purposeAt(hour: number, weekend: boolean, r: Rng): Purpose {
  if (weekend) return r.chance(0.85) ? "leisure" : "midday";
  if (hour >= 6 && hour < 10) return r.chance(0.8) ? "commute_in" : "midday";
  if (hour >= 15 && hour < 19) return r.chance(0.75) ? "commute_out" : "leisure";
  if (hour >= 10 && hour < 15) return r.chance(0.75) ? "midday" : "leisure";
  return "leisure";
}

function originWeight(h: Hotspot, p: Purpose): number {
  switch (p) {
    case "commute_in": return h.home;
    case "commute_out": return h.work + h.campus;
    case "midday": return h.work + h.campus * 0.8 + h.leisure * 0.3;
    case "leisure": return h.home * 0.5 + h.leisure + h.work * 0.3 + h.campus * 0.3;
  }
}

function destinationWeight(h: Hotspot, p: Purpose): number {
  switch (p) {
    case "commute_in": return h.work + h.campus * 1.2;
    case "commute_out": return h.home;
    case "midday": return h.leisure + h.work * 0.5 + h.campus * 0.4;
    case "leisure": return h.leisure + h.home * 0.6;
  }
}

const manhattan = (a: GridPoint, b: GridPoint) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const isEquityPoint = (p: GridPoint) => zonesOfType("equity").some((z) => inZone(p, z));
const inNoParking = (p: GridPoint) => zonesOfType("no_parking").some((z) => inZone(p, z)) || zonesOfType("no_ride").some((z) => inZone(p, z));
const EQUITY_HOTSPOTS = HOTSPOTS.filter((h) => isEquityPoint(h.at));
const OTHER_HOTSPOTS = HOTSPOTS.filter((h) => !isEquityPoint(h.at));

/** A legal place to leave a vehicle near a hotspot: on a sidewalk beside a street. */
function parkingPoint(h: Hotspot, r: Rng): GridPoint {
  for (let attempt = 0; attempt < 8; attempt++) {
    let x = h.at.x + r.normal(0, h.spread * 0.6);
    let y = h.at.y + r.normal(0, h.spread * 0.6);
    const sidewalk = r.chance(0.5) ? 0.05 : -0.05;
    if (r.chance(0.5)) y = Math.round(y) + sidewalk;
    else x = Math.round(x) + sidewalk;
    const b = SERVICE_AREA.bounds;
    const p = { x: Math.min(b.x1 - 0.1, Math.max(b.x0 + 0.1, x)), y: Math.min(b.y1 - 0.1, Math.max(b.y0 + 0.1, y)) };
    if (!inNoParking(p)) return p;
  }
  return { x: Math.round(h.at.x) + 1.05, y: h.at.y };
}

const onStreet = (v: number) => Math.abs(v - Math.round(v)) < 0.08;

/** Street route between two points on the grid: ride along a street, turn, ride along the next. */
function streetPath(from: GridPoint, to: GridPoint): GridPoint[] {
  const path: GridPoint[] = [from];
  if (onStreet(from.y) || !onStreet(from.x)) {
    // Start along the east-west street, turn onto a north-south street near the destination.
    const turnX = onStreet(to.x) ? to.x : Math.round(to.x);
    path.push({ x: turnX, y: from.y }, { x: turnX, y: to.y });
  } else {
    const turnY = onStreet(to.y) ? to.y : Math.round(to.y);
    path.push({ x: from.x, y: turnY }, { x: to.x, y: turnY });
  }
  path.push(to);
  return path.filter((p, i) => i === 0 || manhattan(p, path[i - 1]!) > 1e-6);
}

// --- Vehicles left out for days -------------------------------------------------

function dayNumber(date: string): number {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
}

type Neglect = { firstDay: boolean; lastDay: boolean; at: GridPoint; battery: number };

/** Whether this vehicle spends the day forgotten in one spot, and where. */
function neglectOn(seed: string, op: OperatorProfile, vehicle: number, date: string): Neglect | null {
  const day = dayNumber(date);
  const phase = rng(seed, op.slug, "neglect-phase", vehicle).int(0, 6);
  const week = Math.floor((day + phase) / 7);
  const r = rng(seed, op.slug, "neglect", vehicle, week);
  if (!r.chance(op.behaviour.neglect * 2)) return null;
  const start = r.int(0, 1);
  const length = r.int(3, 5);
  const dayInWeek = (day + phase) % 7;
  if (dayInWeek < start || dayInWeek >= start + length) return null;
  const spot = r.pickWeighted(HOTSPOTS, (h) => 1.2 - h.work - h.leisure * 0.5);
  const nth = dayInWeek - start;
  return {
    firstDay: nth === 0,
    lastDay: nth === length - 1,
    at: parkingPoint({ ...spot, spread: spot.spread + 1 }, r),
    battery: Math.max(16, 27 - nth * 2),
  };
}

// --- The day -------------------------------------------------------------------

type Live = {
  state: VehicleState;
  at: GridPoint;
  battery: number;
  /** Earliest moment the vehicle can be rented or handled again. */
  freeAt: number;
  ridesToday: number;
  neglected: boolean;
  outsideArea: boolean;
};

const planCache = new Map<string, DayPlan>();
const PLAN_CACHE_LIMIT = 36;

export function dayPlan(seed: string, op: OperatorProfile, date: string): DayPlan {
  const key = `${seed}|${op.slug}|${date}`;
  const cached = planCache.get(key);
  if (cached) return cached;
  const plan = buildDayPlan(seed, op, date);
  if (planCache.size >= PLAN_CACHE_LIMIT) planCache.delete(planCache.keys().next().value!);
  planCache.set(key, plan);
  return plan;
}

function buildDayPlan(seed: string, op: OperatorProfile, date: string): DayPlan {
  const r = rng(seed, op.slug, "day", date);
  const startT = serviceDayStart(date);
  const endT = serviceDayStart(addDays(date, 1));
  const vehicles = roster(seed, op);
  const docks = stations(seed, op);
  const weekday = weekdayOf(date);
  const weekend = weekday === 0 || weekday === 6;

  const events: SimEvent[] = [];
  const trips: SimTrip[] = [];
  const initial = new Map<number, { at: GridPoint; battery: number }>();
  let sequence = 0;
  const emit = (e: Omit<SimEvent, "id">) => {
    events.push({ ...e, t: Math.round(e.t), id: seededUuid(seed, op.slug, date, "event", sequence++) });
  };

  // A dock holds only as many bikes as it has places; a rider who finds one full goes on to the next nearest.
  const parked = new Map<SimStation, number>(docks.map((d) => [d, 0]));
  const dockNear = (p: GridPoint): GridPoint => {
    const free = docks.filter((d) => parked.get(d)! < d.capacity);
    const dock = (free.length > 0 ? free : docks).reduce((best, d) => (manhattan(d.at, p) < manhattan(best.at, p) ? d : best));
    parked.set(dock, parked.get(dock)! + 1);
    return dock.at;
  };
  const leaveDock = (p: GridPoint) => {
    const dock = docks.find((d) => d.at.x === p.x && d.at.y === p.y);
    if (dock) parked.set(dock, Math.max(0, parked.get(dock)! - 1));
  };

  // 1. Morning: decide which vehicles go out, and where.
  const overDeploy = weekday === 5 || weekday === 6 ? op.behaviour.weekendOverDeploy : 0;
  const target = Math.min(
    vehicles.length,
    overDeploy > 0 ? op.permittedDevices + overDeploy : Math.min(op.permittedDevices - r.int(4, 18), Math.round(vehicles.length * 0.96)),
  );
  const order = vehicles.map((v) => v.index).sort(() => r.next() - 0.5);
  const inShop = new Set(order.slice(target));

  const live: Live[] = vehicles.map((v) => {
    const state: Live = { state: "removed", at: { x: 0, y: 0 }, battery: 0, freeAt: Infinity, ridesToday: 0, neglected: false, outsideArea: false };
    const neglect = v.docked ? null : neglectOn(seed, op, v.index, date);
    if (neglect) {
      state.neglected = true;
      state.at = neglect.at;
      state.battery = neglect.battery;
      state.state = "available";
      if (neglect.firstDay) {
        emit({ t: startT + r.range(0, 45) * MINUTE_MS, vehicle: v.index, kind: "deploy", at: neglect.at, battery: neglect.battery });
      } else {
        initial.set(v.index, { at: neglect.at, battery: neglect.battery });
      }
      if (neglect.lastDay) {
        emit({ t: startT + 21 * HOUR_MS + r.range(0, 90) * MINUTE_MS, vehicle: v.index, kind: "crew_pickup", at: neglect.at, battery: neglect.battery - 1, reason: "night" });
      }
      return state;
    }
    if (inShop.has(v.index)) return state;

    const spot = r.chance(op.behaviour.equityShare)
      ? r.pickWeighted(EQUITY_HOTSPOTS, (h) => h.home + 0.3)
      : r.pickWeighted(OTHER_HOTSPOTS, (h) => h.home + h.work * 0.6 + h.leisure * 0.4 + h.campus * 0.6);
    state.at = v.docked ? dockNear(spot.at) : parkingPoint(spot, r);
    // Not every battery gets swapped overnight, so some start the day part-used.
    state.battery = r.chance(0.7) ? r.int(82, 100) : r.int(34, 81);
    state.state = "available";
    state.freeAt = startT + r.range(0, 45) * MINUTE_MS;
    emit({ t: state.freeAt, vehicle: v.index, kind: "deploy", at: state.at, battery: state.battery });
    return state;
  });

  // 2. Demand: how many rides people want today, and when.
  const weather = Math.min(1.3, Math.max(0.45, r.normal(1, 0.18)));
  const month = Number(date.slice(5, 7)) - 1;
  const active = live.filter((l) => l.state === "available" && !l.neglected).length;
  const mix = (op.scooters * RIDES_PER_VEHICLE.scooter + op.bikes * RIDES_PER_VEHICLE.bicycle) / (op.scooters + op.bikes);
  const wanted = Math.round(active * mix * weather * MONTH_FACTOR[month]! * DAY_OF_WEEK_FACTOR[weekday]! * 1.12);
  const profile = weekend ? WEEKEND_PROFILE : WEEKDAY_PROFILE;
  const hours = profile.map((_, i) => i);

  type Step = { t: number; crew?: 1 | 2 | 3 };
  const steps: Step[] = Array.from({ length: wanted }, () => {
    const slot = r.pickWeighted(hours, (h) => profile[h]!);
    return { t: Math.round(startT + (slot + r.next()) * HOUR_MS) };
  });
  // Crews go round at 10:00, 14:00 and 19:00.
  steps.push({ t: startT + 5 * HOUR_MS, crew: 1 }, { t: startT + 9 * HOUR_MS, crew: 2 }, { t: startT + 14 * HOUR_MS, crew: 3 });
  steps.sort((a, b) => a.t - b.t);

  const lastRideEnd = startT + 21 * HOUR_MS - 10 * MINUTE_MS;

  const crewVisit = (t: number, round: 1 | 2 | 3) => {
    let moved = 0;
    for (const v of vehicles) {
      const l = live[v.index]!;
      if (l.neglected || l.state === "removed" || l.freeAt > t) continue;
      const when = t + r.range(2, 55) * MINUTE_MS;

      if (l.state === "non_operational") {
        l.battery = 100;
        l.state = "available";
        l.freeAt = when;
        emit({ t: when, vehicle: v.index, kind: "battery_swap", at: l.at, battery: 100 });
        continue;
      }

      const badlyParked = inNoParking(l.at);
      const shouldRecover = (l.outsideArea || badlyParked) && op.slug !== "pronghorn";
      const idleAllDay = round === 2 && op.behaviour.rebalancesToEquity && l.ridesToday === 0 && !v.docked && !isEquityPoint(l.at) && moved < 25 && r.chance(0.25);
      if (!shouldRecover && !idleAllDay) continue;

      const spot = idleAllDay
        ? r.pickWeighted(EQUITY_HOTSPOTS, (h) => h.home)
        : r.pickWeighted(OTHER_HOTSPOTS, (h) => (manhattan(h.at, l.at) < 6 ? 1 : 0.05));
      if (v.docked) leaveDock(l.at);
      const to = v.docked ? dockNear(spot.at) : parkingPoint(spot, r);
      const back = when + r.range(25, 70) * MINUTE_MS;
      const reason: CrewReason = idleAllDay ? "rebalance" : "recover";
      if (idleAllDay) moved++;
      emit({ t: when, vehicle: v.index, kind: "crew_pickup", at: l.at, battery: l.battery, reason });
      // Crews swap a weak battery while they have the vehicle.
      if (l.battery < 40) l.battery = 100;
      emit({ t: back, vehicle: v.index, kind: "crew_dropoff", at: to, battery: l.battery, reason });
      l.at = to;
      l.outsideArea = false;
      l.state = "available";
      l.freeAt = back;
    }
  };

  // 3. Play the day forward.
  for (const step of steps) {
    if (step.crew) {
      crewVisit(step.t, step.crew);
      continue;
    }
    const hour = Math.floor((step.t - startT) / HOUR_MS) + 5;
    const purpose = purposeAt(hour, weekend, r);
    const origin = r.pickWeighted(HOTSPOTS, (h) => originWeight(h, purpose));
    const want = parkingPoint(origin, r);

    // The rider takes the nearest rentable vehicle within a short walk.
    let chosen: SimVehicle | null = null;
    let best = 1.6;
    for (const v of vehicles) {
      const l = live[v.index]!;
      if (l.state !== "available" || l.neglected || l.outsideArea || l.freeAt > step.t || l.battery < LOW_BATTERY) continue;
      const d = manhattan(l.at, want);
      if (d < best) {
        best = d;
        chosen = v;
      }
    }
    if (!chosen) continue; // no vehicle nearby: the ride never happens
    const l = live[chosen.index]!;

    // Where to?
    const falseStart = r.chance(0.02);
    let to: GridPoint;
    let leaves = false;
    if (chosen.docked) leaveDock(l.at);
    if (falseStart) {
      // Unlocked, then put straight back. A docked bike goes back into its dock.
      to = chosen.docked ? dockNear(l.at) : { x: l.at.x + r.range(-0.08, 0.08), y: l.at.y };
    } else {
      const dest = r.pickWeighted(HOTSPOTS, (h) =>
        h === origin ? 0 : destinationWeight(h, purpose) * Math.exp(-manhattan(h.at, origin.at) / 9),
      );
      to = parkingPoint(dest, r);
      const noParkingNearby = zonesOfType("no_parking").find((z) => manhattan({ x: (z.bounds.x0 + z.bounds.x1) / 2, y: (z.bounds.y0 + z.bounds.y1) / 2 }, to) < 2);
      if (chosen.docked) {
        to = dockNear(to);
      } else if (r.chance(op.behaviour.leavesArea)) {
        leaves = true;
        to = OUT_OF_AREA_DESTINATIONS.reduce((a, b) => (manhattan(a, to) < manhattan(b, to) ? a : b));
        to = { x: to.x + r.range(-0.3, 0.3), y: to.y + r.range(-0.3, 0.3) };
      } else if (noParkingNearby && r.chance(op.behaviour.badParking * 4)) {
        const b = noParkingNearby.bounds;
        to = { x: r.range(b.x0 + 0.05, b.x1 - 0.05), y: r.range(b.y0 + 0.05, b.y1 - 0.05) };
      }
    }

    // Ride it, one telemetry point every 20 seconds.
    const path = falseStart ? [l.at, to] : streetPath(l.at, to);
    const cruise = SPEED_MPS[chosen.kind] * r.range(0.82, 1.12);
    const slowZones = zonesOfType("slow_ride");
    const route: RoutePoint[] = [{ t: step.t, x: l.at.x, y: l.at.y, speed: 0 }];
    let t = step.t + (falseStart ? r.range(15, 50) * 1000 : 0);
    let pos = l.at;
    let distanceM = 0;
    let leftAreaAt: RoutePoint | null = null;
    for (let leg = 1; leg < path.length && !falseStart; leg++) {
      const target = path[leg]!;
      while (manhattan(pos, target) > 1e-6) {
        const slow = slowZones.some((z) => inZone(pos, z));
        const speed = slow && op.behaviour.governsSlowZones ? Math.min(cruise, GOVERNED_SPEED_MPS * r.range(0.9, 1)) : cruise * r.range(0.9, 1.06);
        const reach = (speed * TELEMETRY_STEP_MS) / 1000 / BLOCK_METERS;
        const remaining = manhattan(pos, target);
        const fraction = Math.min(1, reach / remaining);
        pos = { x: pos.x + (target.x - pos.x) * fraction, y: pos.y + (target.y - pos.y) * fraction };
        t += TELEMETRY_STEP_MS * Math.min(1, remaining / reach);
        distanceM += Math.min(reach, remaining) * BLOCK_METERS;
        const point = { t: Math.round(t), x: pos.x + r.range(-0.008, 0.008), y: pos.y + r.range(-0.008, 0.008), speed };
        route.push(point);
        if (leaves && !leftAreaAt && !inZone(pos, SERVICE_AREA)) leftAreaAt = point;
      }
    }
    if (falseStart) route.push({ t: Math.round(t), x: to.x, y: to.y, speed: 0 });
    if (leaves && !leftAreaAt) leftAreaAt = route[route.length - 1]!;
    // Locking up takes a moment.
    const endT = Math.round(t + (falseStart ? 0 : r.range(8, 40) * 1000));
    if (endT > lastRideEnd) continue;
    route.push({ t: endT, x: to.x, y: to.y, speed: 0 });

    const tripId = seededUuid(seed, op.slug, date, "trip", trips.length);
    const endBattery = Math.max(1, Math.round(l.battery - Math.max(falseStart ? 0 : 1, (distanceM / 1000) * DRAIN_PCT_PER_KM[chosen.kind])));
    emit({ t: step.t, vehicle: chosen.index, kind: "trip_start", at: l.at, battery: l.battery, tripId });
    if (leftAreaAt) emit({ t: leftAreaAt.t, vehicle: chosen.index, kind: "trip_leave_area", at: { x: leftAreaAt.x, y: leftAreaAt.y }, battery: endBattery, tripId });
    // A ride that ends outside the permitted area has no trip_end event: the vehicle left
    // the city's jurisdiction mid-ride, and the trip record is the only account of where it stopped.
    if (!leaves) emit({ t: endT, vehicle: chosen.index, kind: "trip_end", at: to, battery: endBattery, tripId });
    trips.push({ id: tripId, vehicle: chosen.index, startT: step.t, endT, route, distanceM, startBattery: l.battery, endBattery, endedOutsideArea: leaves });

    l.at = to;
    l.battery = endBattery;
    l.freeAt = endT;
    l.ridesToday++;
    l.outsideArea = leaves;
    if (leaves) {
      l.state = "elsewhere";
    } else if (endBattery < LOW_BATTERY) {
      l.state = "non_operational";
      l.freeAt = endT + 1000;
      emit({ t: endT + 1000, vehicle: chosen.index, kind: "battery_low", at: to, battery: endBattery });
    }
  }

  // 4. Overnight: crews collect the fleet for charging, from 02:00.
  for (const v of vehicles) {
    const l = live[v.index]!;
    if (l.neglected || l.state === "removed") continue;
    const when = Math.max(startT + 21 * HOUR_MS + r.range(0, 100) * MINUTE_MS, l.freeAt + MINUTE_MS);
    emit({ t: Math.min(when, endT - MINUTE_MS), vehicle: v.index, kind: "crew_pickup", at: l.at, battery: l.battery, reason: "night" });
  }

  events.sort((a, b) => a.t - b.t);
  const eventsByVehicle: SimEvent[][] = vehicles.map(() => []);
  for (const e of events) eventsByVehicle[e.vehicle]!.push(e);

  return { operator: op, date, startT, endT, vehicles, stations: docks, events, eventsByVehicle, trips, tripsById: new Map(trips.map((t) => [t.id, t])), initial };
}

// --- Reading a plan at an instant -------------------------------------------------

export type VehicleSnapshot = {
  vehicle: SimVehicle;
  state: VehicleState;
  at: GridPoint;
  battery: number;
  speed: number;
  /** Time of the event that put the vehicle in its current state. */
  since: number;
  lastEvent: SimEvent | null;
  tripId: string | null;
  outsideArea: boolean;
};

function lastEventAtOrBefore(list: SimEvent[], t: number): SimEvent | null {
  let lo = 0;
  let hi = list.length - 1;
  let found: SimEvent | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid]!.t <= t) {
      found = list[mid]!;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

export function positionOnRoute(route: RoutePoint[], t: number): RoutePoint {
  let previous = route[0]!;
  for (const point of route) {
    if (point.t > t) {
      const span = point.t - previous.t || 1;
      const f = (t - previous.t) / span;
      return { t, x: previous.x + (point.x - previous.x) * f, y: previous.y + (point.y - previous.y) * f, speed: point.speed };
    }
    previous = point;
  }
  return previous;
}

export function snapshotAt(plan: DayPlan, t: number): VehicleSnapshot[] {
  return plan.vehicles.map((vehicle) => {
    const e = lastEventAtOrBefore(plan.eventsByVehicle[vehicle.index]!, t);
    if (!e) {
      const start = plan.initial.get(vehicle.index);
      return start
        ? { vehicle, state: "available" as const, at: start.at, battery: start.battery, speed: 0, since: plan.startT, lastEvent: null, tripId: null, outsideArea: false }
        : { vehicle, state: "removed" as const, at: { x: 0, y: 0 }, battery: 0, speed: 0, since: plan.startT, lastEvent: null, tripId: null, outsideArea: false };
    }
    const base = { vehicle, at: e.at, battery: e.battery, speed: 0, since: e.t, lastEvent: e, tripId: null as string | null, outsideArea: !inZone(e.at, SERVICE_AREA) };
    switch (e.kind) {
      case "trip_start":
      case "trip_leave_area": {
        const trip = plan.tripsById.get(e.tripId!)!;
        const p = positionOnRoute(trip.route, t);
        const at = { x: p.x, y: p.y };
        const riding = t < trip.endT;
        return {
          ...base,
          state: e.kind === "trip_leave_area" ? "elsewhere" : "on_trip",
          at,
          speed: riding ? p.speed : 0,
          tripId: riding ? trip.id : null,
          outsideArea: !inZone(at, SERVICE_AREA),
        };
      }
      case "battery_low":
        return { ...base, state: "non_operational" };
      case "crew_pickup":
        return { ...base, state: "removed" };
      default:
        return { ...base, state: "available" };
    }
  });
}

/**
 * The most recent event for a vehicle at or before `t`, looking back across
 * earlier service days when today has none (a vehicle in the shop, or one left
 * on the street for days).
 */
export function lastEventBefore(seed: string, op: OperatorProfile, vehicle: number, t: number, maxDays = 8): SimEvent | null {
  let date = serviceDayOf(t);
  for (let i = 0; i < maxDays; i++) {
    const found = lastEventAtOrBefore(dayPlan(seed, op, date).eventsByVehicle[vehicle]!, t);
    if (found) return found;
    date = addDays(date, -1);
  }
  return null;
}
