import { describe, expect, it } from "vitest";
import { eventRow, vehicleFamily } from "./realtime";

describe("vehicle families", () => {
  it("folds the MDS vehicle types into the two the fee schedule cares about", () => {
    expect(vehicleFamily("scooter_standing")).toBe("scooter");
    expect(vehicleFamily("scooter_seated")).toBe("scooter");
    expect(vehicleFamily("bicycle")).toBe("bicycle");
    expect(vehicleFamily("cargo_bicycle")).toBe("bicycle");
    expect(vehicleFamily("moped")).toBe("other");
  });
});

describe("a status change from an operator", () => {
  const op = { id: "op-1" } as Parameters<typeof eventRow>[0];
  const event = { event_id: "e1", device_id: "d1", vehicle_state: "available", event_types: ["trip_end"], timestamp: 1_790_000_000_000, location: { lat: 40.76, lng: -111.89 } };

  it("is stored under the operator it was fetched from, not one named in the record", () => {
    expect(eventRow(op, event)).toMatchObject({ operator_id: "op-1", device_id: "d1", state: "available", lat: 40.76, lng: -111.89, ts: new Date(1_790_000_000_000) });
  });

  it("keeps a missing battery or trip as unknown rather than zero", () => {
    expect(eventRow(op, event)).toMatchObject({ battery: null, trip_id: null });
    expect(eventRow(op, { ...event, battery_percent: 0, trip_ids: ["t9"] })).toMatchObject({ battery: 0, trip_id: "t9" });
  });
});
