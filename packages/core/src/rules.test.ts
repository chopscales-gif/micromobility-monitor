import { describe, expect, it } from "vitest";
import {
  buildStays,
  capDay,
  checkParams,
  dwellBreaches,
  equityCount,
  equityWeek,
  fleetAt,
  fleetCounts,
  misparked,
  overLimit,
  slaBreaches,
  speedDay,
  SPEED_GAP,
  zoneInForce,
  zonePasses,
  type RoutePoint,
  type RuleZone,
  type SpeedPass,
  type StatusChange,
} from "./rules";

const HOUR = 3_600_000;
const MIN = 60_000;
const T0 = Date.parse("2026-10-05T06:00:00Z"); // midnight in Salt Lake City

const square = (x0: number, y0: number, x1: number, y1: number): [number, number][][] => [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]];
const zone = (id: string, type: string, box: [number, number, number, number], extra: Partial<RuleZone> = {}): RuleZone => ({
  id,
  name: id,
  type,
  polygons: [square(...box)],
  speedLimitKph: null,
  effectiveFrom: 0,
  retiredAt: null,
  ...extra,
});

const SERVICE = zone("service", "service_area", [-111.95, 40.74, -111.85, 40.8]);
const PLAZA = zone("plaza", "no_parking", [-111.892, 40.76, -111.89, 40.762]);
const SQUARE = zone("temple", "no_ride", [-111.896, 40.77, -111.894, 40.772]);
const WEST = zone("west", "equity", [-111.95, 40.74, -111.92, 40.8]);
const SLOW = zone("main", "slow_ride", [-111.8915, 40.75, -111.8905, 40.76], { speedLimitKph: 13 });
const ZONES = [SERVICE, PLAZA, SQUARE, WEST, SLOW];

const STREET: [number, number] = [-111.88, 40.755]; // inside the service area, in no special zone
const IN_PLAZA: [number, number] = [-111.891, 40.761];
const IN_WEST: [number, number] = [-111.93, 40.76];

const change = (deviceId: string, minutes: number, state: string, at: [number, number] = STREET): StatusChange => ({ deviceId, ts: T0 + minutes * MIN, state, lng: at[0], lat: at[1] });

describe("fleet cap", () => {
  const day = { start: T0, end: T0 + 24 * HOUR };

  it("counts vehicles that are on the street, including ones being ridden, and not ones in the operator's hands", () => {
    const steps = fleetCounts([
      change("a", 0, "available"),
      change("b", 0, "available"),
      change("a", 10, "on_trip"),
      change("b", 20, "removed"),
      change("c", 30, "non_operational"),
      change("a", 40, "elsewhere"),
    ]);
    expect(steps).toEqual([
      [T0, 2],
      [T0 + 20 * MIN, 1],
      [T0 + 30 * MIN, 2],
      [T0 + 40 * MIN, 1],
    ]);
  });

  /** A fleet of `n` vehicles put out at `fromMin` and collected at `toMin`. */
  const deploy = (n: number, fromMin: number, toMin: number, tag: string) =>
    Array.from({ length: n }, (_, i) => [change(`${tag}${i}`, fromMin, "available"), change(`${tag}${i}`, toMin, "removed")]).flat();
  const stepsFor = (events: StatusChange[]) => fleetCounts(events.sort((a, b) => a.ts - b.ts));

  it("does not flag a fleet that stays at the cap", () => {
    const result = capDay(stepsFor(deploy(10, 60, 600, "v")), day, 10, 60);
    expect(result.peak).toBe(10);
    expect(result.minutesOver).toBe(0);
    expect(result.breachedAt).toBeNull();
  });

  it("forgives a short overshoot inside the grace period", () => {
    const steps = stepsFor([...deploy(10, 60, 600, "v"), ...deploy(2, 120, 150, "x")]);
    const result = capDay(steps, day, 10, 60);
    expect(result.peak).toBe(12);
    expect(result.minutesOver).toBe(30);
    expect(result.breachedAt).toBeNull();
  });

  it("flags a fleet that stays over the cap past the grace period, from the moment the grace ran out", () => {
    const steps = stepsFor([...deploy(10, 60, 600, "v"), ...deploy(3, 120, 300, "x")]);
    const result = capDay(steps, day, 10, 60);
    expect(result.peak).toBe(13);
    expect(result.peakAt).toBe(T0 + 120 * MIN);
    expect(result.minutesOver).toBe(180);
    expect(result.longestRunMinutes).toBe(180);
    expect(result.breachedAt).toBe(T0 + 180 * MIN);
  });

  it("does not add separate short overshoots together to make a breach", () => {
    const steps = stepsFor([...deploy(10, 60, 600, "v"), ...deploy(1, 120, 160, "x"), ...deploy(1, 200, 240, "y")]);
    const result = capDay(steps, day, 10, 60);
    expect(result.minutesOver).toBe(80);
    expect(result.longestRunMinutes).toBe(40);
    expect(result.breachedAt).toBeNull();
  });

  it("carries a fleet already over the cap at midnight into the new day", () => {
    const steps = stepsFor(deploy(12, -120, 30, "v"));
    const result = capDay(steps, day, 10, 20);
    expect(result.peak).toBe(12);
    expect(result.peakAt).toBe(T0);
    expect(result.minutesOver).toBe(30);
    expect(result.breachedAt).toBe(T0 + 20 * MIN);
  });

  it("reports the highest count in each hour", () => {
    const result = capDay(stepsFor([...deploy(4, 30, 600, "v"), ...deploy(2, 70, 80, "x")]), day, 10, 60);
    expect(result.hourly).toHaveLength(24);
    expect(result.hourly.slice(0, 3)).toEqual([4, 6, 4]);
    expect(result.hourly[10]).toBe(0);
  });

  it("measures a day still in progress only up to now", () => {
    const steps = stepsFor(deploy(12, 60, 2000, "v"));
    const result = capDay(steps, day, 10, 60, T0 + 90 * MIN);
    expect(result.minutesOver).toBe(30);
    expect(result.breachedAt).toBeNull();
    expect(result.hourly).toHaveLength(2);
  });
});

describe("equity minimum", () => {
  it("counts only vehicles a rider could rent, and only zones in force", () => {
    const fleet = [change("a", 0, "available", IN_WEST), change("b", 0, "available"), change("c", 0, "non_operational", IN_WEST), change("d", 0, "on_trip", IN_WEST), change("e", 0, "available")];
    expect(equityCount(fleet, ZONES, T0)).toEqual({ available: 3, inZones: 1 });
    const later = [{ ...WEST, effectiveFrom: T0 + HOUR }];
    expect(equityCount(fleet, later, T0)).toEqual({ available: 3, inZones: 0 });
  });

  it("takes each vehicle's latest status at the moment of the count", () => {
    const events = [change("a", 0, "available", IN_WEST), change("b", 5, "available"), change("a", 30, "on_trip", IN_WEST), change("a", 50, "available")];
    const [early, late] = fleetAt(events, [T0 + 10 * MIN, T0 + 60 * MIN]);
    expect(equityCount(early!.values(), ZONES, T0)).toEqual({ available: 2, inZones: 1 });
    expect(equityCount(late!.values(), ZONES, T0)).toEqual({ available: 2, inZones: 0 });
  });

  it("averages the daily shares rather than pooling the week", () => {
    const week = equityWeek([
      { date: "2026-10-05", available: 100, inZones: 20 },
      { date: "2026-10-06", available: 1000, inZones: 0 },
    ]);
    expect(week?.sharePct).toBe(10);
    expect(week?.days.map((d) => d.sharePct)).toEqual([20, 0]);
  });

  it("leaves out a morning with nothing available, and gives no figure for a week of them", () => {
    expect(equityWeek([{ date: "2026-10-05", available: 0, inZones: 0 }, { date: "2026-10-06", available: 50, inZones: 5 }])?.sharePct).toBe(10);
    expect(equityWeek([{ date: "2026-10-05", available: 0, inZones: 0 }])).toBeNull();
  });
});

describe("stays", () => {
  it("treats repeated reports from the same spot as one stay", () => {
    const stays = buildStays([change("a", 0, "available"), change("a", 600, "non_operational"), change("a", 900, "available"), change("a", 1000, "on_trip")]);
    expect(stays).toHaveLength(1);
    expect(stays[0]).toMatchObject({ from: T0, to: T0 + 1000 * MIN, lastState: "available" });
  });

  it("ends a stay when the vehicle is ridden, collected, or reappears somewhere else", () => {
    const moved: [number, number] = [STREET[0] + 0.001, STREET[1]];
    const stays = buildStays([change("a", 0, "available"), change("a", 60, "removed"), change("a", 120, "available"), change("a", 180, "available", moved)]);
    expect(stays.map((s) => [s.from - T0, s.to === null ? null : s.to - T0])).toEqual([
      [0, 60 * MIN],
      [120 * MIN, 180 * MIN],
      [180 * MIN, null],
    ]);
  });

  it("ignores GPS wander of a few metres", () => {
    const wobble: [number, number] = [STREET[0] + 0.00005, STREET[1]]; // about four metres
    expect(buildStays([change("a", 0, "available"), change("a", 60, "available", wobble)])).toHaveLength(1);
  });

  it("keeps vehicles separate", () => {
    const stays = buildStays([change("a", 0, "available"), change("b", 1, "available"), change("a", 30, "on_trip")]);
    expect(stays.map((s) => [s.deviceId, s.to === null])).toEqual([["a", false], ["b", true]]);
  });
});

describe("parking dwell limit", () => {
  const stays = buildStays([change("a", 0, "available"), change("a", 80 * 60, "on_trip"), change("b", 0, "available"), change("b", 71 * 60, "on_trip"), change("c", 0, "available")]);

  it("flags a vehicle left longer than the limit, closed or still standing", () => {
    const found = dwellBreaches(stays, 72, T0 + 100 * HOUR);
    expect(found.map((f) => [f.stay.deviceId, f.hours])).toEqual([["a", 80], ["c", 100]]);
    expect(found[0]!.breachAt).toBe(T0 + 72 * HOUR);
  });

  it("does not flag a vehicle still inside the limit", () => {
    const early = buildStays([change("a", 0, "available"), change("b", 0, "available"), change("c", 0, "available")]);
    expect(dwellBreaches(early, 72, T0 + 72 * HOUR)).toEqual([]);
  });
});

describe("rebalancing deadline", () => {
  it("names why a vehicle may not stand where it is", () => {
    const [plaza, temple, outside, fine] = buildStays([
      change("a", 0, "available", IN_PLAZA),
      change("b", 0, "available", [-111.895, 40.771]),
      change("c", 0, "available", [-111.8, 40.755]),
      change("d", 0, "available"),
    ]);
    expect(misparked(plaza!, ZONES)).toEqual({ reason: "no_parking", zone: "plaza" });
    expect(misparked(temple!, ZONES)).toEqual({ reason: "no_ride", zone: "temple" });
    expect(misparked(outside!, ZONES)).toEqual({ reason: "outside_area", zone: null });
    expect(misparked(fine!, ZONES)).toBeNull();
  });

  it("believes the operator when it reports a vehicle as outside the area", () => {
    const [stay] = buildStays([change("a", 0, "elsewhere")]);
    expect(misparked(stay!, ZONES)?.reason).toBe("outside_area");
  });

  it("accepts a vehicle inside any one of several service areas", () => {
    const annex = zone("annex", "service_area", [-111.81, 40.75, -111.79, 40.76]);
    const [stay] = buildStays([change("a", 0, "available", [-111.8, 40.755])]);
    expect(misparked(stay!, [...ZONES, annex])).toBeNull();
  });

  it("does not apply a zone to a vehicle parked before the zone existed, or after it was retired", () => {
    const [stay] = buildStays([change("a", 60, "available", IN_PLAZA)]);
    expect(misparked(stay!, [SERVICE, { ...PLAZA, effectiveFrom: T0 + 2 * HOUR }])).toBeNull();
    expect(misparked(stay!, [SERVICE, { ...PLAZA, retiredAt: T0 + 30 * MIN }])).toBeNull();
    expect(zoneInForce({ ...PLAZA, retiredAt: T0 }, T0)).toBe(false);
  });

  it("counts a badly parked vehicle only once the deadline has passed", () => {
    const stays = buildStays([
      change("quick", 0, "available", IN_PLAZA),
      change("quick", 90, "removed", IN_PLAZA),
      change("slow", 0, "available", IN_PLAZA),
      change("slow", 300, "removed", IN_PLAZA),
      change("still", 60, "available", IN_PLAZA),
      change("legal", 0, "available"),
    ]);
    const found = slaBreaches(stays, ZONES, 2, T0 + 6 * HOUR);
    expect(found.map((f) => [f.stay.deviceId, f.hours, f.breachAt - T0])).toEqual([
      ["slow", 5, 2 * HOUR],
      ["still", 5, 3 * HOUR],
    ]);
  });
});

describe("slow zones", () => {
  const p = (seconds: number, lat: number, speedMps: number | null, lng = -111.891): RoutePoint => [T0 + seconds * 1000, lng, lat, speedMps];

  it("collects the readings a ride produced inside a slow zone, in km/h", () => {
    const passes = zonePasses([p(0, 40.749, 5), p(20, 40.751, 5), p(40, 40.753, 3.3), p(60, 40.761, 5)], ZONES);
    expect(passes).toEqual([{ zoneId: "main", enteredAt: T0 + 20_000, limitKph: 13, speeds: [18, 11.9] }]);
  });

  it("marks where a rider left the zone and came back, and where a reading had no speed", () => {
    const passes = zonePasses([p(0, 40.751, 5), p(20, 40.751, 5, -111.8), p(40, 40.752, 5), p(60, 40.753, null)], ZONES);
    expect(passes[0]!.speeds).toEqual([18, SPEED_GAP, 18, SPEED_GAP]);
  });

  it("ignores zones without a limit, zones not yet in force, and rides that never enter", () => {
    const path = [p(0, 40.751, 5), p(20, 40.753, 5)];
    expect(zonePasses(path, [{ ...SLOW, speedLimitKph: null }])).toEqual([]);
    expect(zonePasses(path, [{ ...SLOW, effectiveFrom: T0 + HOUR }])).toEqual([]);
    expect(zonePasses([p(0, 40.749, 5)], ZONES)).toEqual([]);
  });

  it("needs two readings in a row over the limit plus the margin", () => {
    expect(overLimit([18, 11.9, 11.9], 13, 2).sustained).toBe(false); // governed: fast only on entry
    expect(overLimit([16, 17, 12], 13, 2)).toEqual({ sustained: true, readingsOver: 2, maxKph: 17 });
    expect(overLimit([14.9, 15, 15], 13, 2).sustained).toBe(false); // inside the margin
    expect(overLimit([18, 12, 18], 13, 2).sustained).toBe(false); // not in a row
    expect(overLimit([18, SPEED_GAP, 18], 13, 2).sustained).toBe(false); // either side of a gap
  });

  const pass = (i: number, speeds: number[]): SpeedPass => ({ tripId: `t${i}`, deviceId: `d${i}`, zoneId: "main", enteredAt: T0 + i * MIN, limitKph: 13, speeds });

  it("gives the share of rides over the limit and lists the fastest", () => {
    const passes = [...Array.from({ length: 36 }, (_, i) => pass(i, [18, 11.9, 11.9])), pass(40, [16, 16.5]), pass(41, [17, 17.3, 17]), pass(42, [16, 16]), pass(43, [15.5, 16])];
    const day = speedDay(passes, 2)!;
    expect(day.passes).toBe(40);
    expect(day.speeding).toBe(4);
    expect(day.sharePct).toBe(10);
    expect(day.zones).toEqual([{ zoneId: "main", limitKph: 13, passes: 40, speeding: 4 }]);
    expect(day.worst[0]).toMatchObject({ tripId: "t41", maxKph: 17.3, readingsOver: 3, readings: 3 });
  });

  it("gives no verdict on a day with too few rides to judge", () => {
    expect(speedDay(Array.from({ length: 19 }, (_, i) => pass(i, [18, 18])), 2)).toBeNull();
  });
});

describe("rule settings", () => {
  it("accepts settings inside their ranges", () => {
    expect(checkParams("rebalancing_sla", { hours: "2.5", dailyAllowance: "5" })).toEqual({ ok: true, params: { hours: 2.5, dailyAllowance: 5 } });
  });

  it("refuses a missing, malformed, fractional or out-of-range setting, naming it", () => {
    expect(checkParams("parking_dwell", {})).toMatchObject({ ok: false });
    expect(checkParams("parking_dwell", { limitHours: "72h" })).toMatchObject({ ok: false });
    expect(checkParams("parking_dwell", { limitHours: "-5" })).toMatchObject({ ok: false });
    expect(checkParams("parking_dwell", { limitHours: "72.5" })).toMatchObject({ ok: false, problem: expect.stringContaining("whole number") });
    expect(checkParams("parking_dwell", { limitHours: "2" })).toMatchObject({ ok: false, problem: expect.stringContaining("between 12 and 336") });
  });

  it("drops fields the rule does not have", () => {
    expect(checkParams("fleet_cap", { graceMinutes: "30", limitHours: "1" })).toEqual({ ok: true, params: { graceMinutes: 30 } });
  });
});
