import { describe, expect, it } from "vitest";
import { FEED_IDS, validateFeed } from "./validate";

const ID = "3c9604d6-b5ee-11e8-96f8-529269fb1459";
const TRIP = "0f3bbd2a-5b1c-4f39-9d3c-6f7a1f0d6f10";
const T = 1_795_000_000_000;

const event = (over: Record<string, unknown> = {}) => ({
  device_id: ID,
  provider_id: ID,
  event_id: ID,
  vehicle_state: "available",
  event_types: ["trip_end"],
  timestamp: T,
  location: { lat: 40.7608, lng: -111.891 },
  battery_percent: 71,
  trip_ids: [TRIP],
  ...over,
});
const events = (...list: unknown[]) => validateFeed("mds.events_recent", { version: "2.1.0", events: list });

const trip = (over: Record<string, unknown> = {}) => ({
  provider_id: ID,
  device_id: ID,
  trip_id: TRIP,
  trip_type: "rider",
  start_time: T,
  end_time: T + 540_000,
  start_location: { lat: 40.7608, lng: -111.891 },
  end_location: { lat: 40.765, lng: -111.88 },
  duration: 540,
  distance: 1930,
  ...over,
});
const trips = (...list: unknown[]) => validateFeed("mds.trips", { version: "2.1.0", trips: list });

const gbfsVehicle = (over: Record<string, unknown> = {}) => ({
  vehicle_id: "a1",
  lat: 40.7608,
  lon: -111.891,
  is_reserved: false,
  is_disabled: false,
  vehicle_type_id: "scooter",
  current_range_meters: 12000,
  ...over,
});
const gbfsVehicles = (...list: unknown[]) =>
  validateFeed("gbfs.vehicle_status", { last_updated: "2026-11-18T21:30:00Z", ttl: 60, version: "3.0", data: { vehicles: list } });

describe("envelope", () => {
  it.each(FEED_IDS)("%s rejects an empty response and trusts no records", (feed) => {
    const result = validateFeed(feed, {});
    expect(result.envelopeIssues.length).toBeGreaterThan(0);
    expect(result.validRecords).toEqual([]);
  });

  it("names the missing envelope fields", () => {
    const result = validateFeed("mds.vehicles_status", { version: "2.1.0", vehicles_status: [] });
    expect(result.envelopeIssues.map((i) => i.path).sort()).toEqual(["/last_updated", "/ttl"]);
  });

  it("rejects a GBFS feed that claims another version", () => {
    const result = validateFeed("gbfs.vehicle_status", { last_updated: "2026-11-18T21:30:00Z", ttl: 60, version: "2.3", data: { vehicles: [] } });
    expect(result.envelopeIssues[0]?.path).toBe("/version");
  });

  it("rejects a GBFS 2.x style numeric last_updated", () => {
    const result = validateFeed("gbfs.vehicle_status", { last_updated: 1795000000, ttl: 60, version: "3.0", data: { vehicles: [] } });
    expect(result.envelopeIssues[0]).toMatchObject({ path: "/last_updated", keyword: "type" });
  });

  it("rejects an MDS realtime ttl above the five-minute maximum", () => {
    const result = validateFeed("mds.vehicles", { version: "2.1.0", last_updated: T, ttl: 900_000, vehicles: [] });
    expect(result.envelopeIssues[0]).toMatchObject({ path: "/ttl", keyword: "maximum" });
  });
});

describe("records are judged one at a time", () => {
  it("keeps the good records when one is broken", () => {
    const result = events(event(), event({ event_types: undefined }), event());
    expect(result.recordCount).toBe(3);
    expect(result.validRecords).toHaveLength(2);
    expect(result.invalidRecords).toHaveLength(1);
    expect(result.invalidRecords[0]).toMatchObject({ index: 1, recordId: ID });
  });
});

describe("MDS events", () => {
  it("accepts a valid trip end", () => {
    expect(events(event()).invalidRecords).toEqual([]);
  });

  it("requires a trip id on trip events (patched rule)", () => {
    const [bad] = events(event({ trip_ids: undefined })).invalidRecords;
    expect(bad?.issues).toEqual([{ path: "/trip_ids", keyword: "required", message: "is required but missing" }]);
  });

  it("does not require a trip id on other events", () => {
    expect(events(event({ event_types: ["battery_charged"], trip_ids: undefined })).invalidRecords).toEqual([]);
  });

  it("rejects an event type that does not lead to the stated vehicle state", () => {
    const [bad] = events(event({ vehicle_state: "on_trip", event_types: ["trip_end"] })).invalidRecords;
    expect(bad?.issues[0]).toMatchObject({ path: "/event_types/0", keyword: "enum" });
  });

  it("rejects states from other modes and older MDS versions", () => {
    expect(events(event({ vehicle_state: "stopped", event_types: ["trip_stop"] })).invalidRecords).toHaveLength(1);
    expect(events(event({ vehicle_state: "in_use" })).invalidRecords).toHaveLength(1);
  });

  it("rejects text timestamps, and reports what it got", () => {
    const [bad] = events(event({ timestamp: "2026-11-18T19:19:37Z" })).invalidRecords;
    expect(bad?.issues[0]?.message).toContain('got "2026-11-18T19:19:37Z"');
  });

  it("rejects timestamps in seconds", () => {
    const [bad] = events(event({ timestamp: Math.floor(T / 1000) })).invalidRecords;
    expect(bad?.issues[0]).toMatchObject({ path: "/timestamp", keyword: "minimum" });
  });

  it("requires a location", () => {
    expect(events(event({ location: undefined })).invalidRecords).toHaveLength(1);
    expect(events(event({ location: { lat: "40.76", lng: "-111.89" } })).invalidRecords).toHaveLength(1);
  });
});

describe("MDS trips", () => {
  it("accepts a valid rider trip", () => {
    expect(trips(trip()).invalidRecords).toEqual([]);
  });

  it("accepts the parking categories added in MDS 2.1", () => {
    expect(trips(trip({ parking_category: "dock" })).invalidRecords).toEqual([]);
  });

  it("applies only the micromobility trip types", () => {
    expect(trips(trip({ trip_type: "delivery" })).invalidRecords).toHaveLength(1);
  });

  it.each([
    ["a missing end location", { end_location: undefined }, "/end_location"],
    ["a fractional duration", { duration: 9.5 }, "/duration"],
    ["a negative distance", { distance: -1 }, "/distance"],
  ])("rejects %s", (_name, over, path) => {
    const [bad] = trips(trip(over)).invalidRecords;
    expect(bad?.issues[0]?.path).toBe(path);
    expect(bad?.recordId).toBe(TRIP);
  });
});

describe("MDS vehicles", () => {
  const vehicle = (over: Record<string, unknown> = {}) => ({
    device_id: ID,
    provider_id: ID,
    vehicle_id: "KES-0001",
    vehicle_type: "scooter_standing",
    propulsion_types: ["electric"],
    ...over,
  });
  const vehicles = (...list: unknown[]) => validateFeed("mds.vehicles", { version: "2.1.0", last_updated: T, ttl: 60_000, vehicles: list });

  it("accepts the vehicle types added in MDS 2.1", () => {
    expect(vehicles(vehicle(), vehicle({ vehicle_type: "scooter" })).invalidRecords).toEqual([]);
  });

  it("rejects an unknown vehicle type and an empty propulsion list", () => {
    expect(vehicles(vehicle({ vehicle_type: "e-scooter" }), vehicle({ propulsion_types: [] })).invalidRecords).toHaveLength(2);
  });
});

describe("GBFS vehicle_status", () => {
  it("accepts a free-floating vehicle and a docked one", () => {
    expect(gbfsVehicles(gbfsVehicle(), gbfsVehicle({ lat: undefined, lon: undefined, station_id: "s1" })).invalidRecords).toEqual([]);
  });

  it("rejects a vehicle with neither a position nor a station", () => {
    expect(gbfsVehicles(gbfsVehicle({ lat: undefined, lon: undefined })).invalidRecords).toHaveLength(1);
  });

  it("rejects fuel given as 0-100 instead of 0-1", () => {
    const [bad] = gbfsVehicles(gbfsVehicle({ current_fuel_percent: 83 })).invalidRecords;
    expect(bad?.issues[0]).toMatchObject({ path: "/current_fuel_percent", keyword: "maximum" });
  });

  it("rejects a missing is_reserved flag", () => {
    const [bad] = gbfsVehicles(gbfsVehicle({ is_reserved: undefined })).invalidRecords;
    expect(bad?.issues[0]).toMatchObject({ path: "/is_reserved", keyword: "required" });
    expect(bad?.recordId).toBe("a1");
  });
});
