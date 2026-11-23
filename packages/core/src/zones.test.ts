import { describe, expect, it } from "vitest";
import { parseZoneGeoJson } from "./zones";

const ring = [[-111.9, 40.76], [-111.89, 40.76], [-111.89, 40.77], [-111.9, 40.77], [-111.9, 40.76]];
const polygon = { type: "Polygon", coordinates: [ring] };
const parse = (value: unknown) => parseZoneGeoJson(JSON.stringify(value));

describe("zone upload", () => {
  it("reads a bare polygon", () => {
    const result = parse(polygon);
    expect(result).toMatchObject({ ok: true, name: null, vertices: 5 });
    if (result.ok) expect(result.polygons).toEqual([[ring]]);
  });

  it("reads a feature and takes its name", () => {
    expect(parse({ type: "Feature", properties: { name: "  Pioneer Park  " }, geometry: polygon })).toMatchObject({ ok: true, name: "Pioneer Park" });
  });

  it("gathers every polygon in a feature collection, including multipolygons", () => {
    const result = parse({
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: {}, geometry: polygon },
        { type: "Feature", properties: { name: "Two parts" }, geometry: { type: "MultiPolygon", coordinates: [[ring], [ring]] } },
      ],
    });
    expect(result.ok && result.polygons.length).toBe(3);
    expect(result.ok && result.name).toBe("Two parts");
  });

  it("closes a ring left open", () => {
    const result = parse({ type: "Polygon", coordinates: [ring.slice(0, 4)] });
    expect(result.ok && result.polygons[0]![0]).toEqual(ring);
  });

  it("drops altitude", () => {
    const result = parse({ type: "Polygon", coordinates: [ring.map(([lng, lat]) => [lng, lat, 1300])] });
    expect(result.ok && result.polygons[0]![0]![0]).toEqual([-111.9, 40.76]);
  });

  it("refuses a file that is not JSON or not GeoJSON", () => {
    expect(parseZoneGeoJson("zone,lat,lng")).toMatchObject({ ok: false, problem: "The file is not valid JSON." });
    expect(parse([1, 2])).toMatchObject({ ok: false });
    expect(parse({ type: "Topology" })).toMatchObject({ ok: false, problem: expect.stringContaining("Topology") });
    expect(parse({ type: "FeatureCollection", features: [] })).toMatchObject({ ok: false });
  });

  it("refuses points and lines rather than skipping them", () => {
    expect(parse({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [-111.9, 40.76] } })).toMatchObject({ ok: false, problem: expect.stringContaining("Point") });
    expect(parse({ type: "FeatureCollection", features: [{ type: "Feature", geometry: polygon }, { type: "Feature", geometry: { type: "LineString", coordinates: ring } }] })).toMatchObject({ ok: false });
    expect(parse({ type: "Feature", geometry: null })).toMatchObject({ ok: false, problem: "A feature has no geometry." });
  });

  it("says so when latitude and longitude are the wrong way round", () => {
    const result = parse({ type: "Polygon", coordinates: [ring.map(([lng, lat]) => [lat, lng])] });
    expect(result).toMatchObject({ ok: false, problem: expect.stringContaining("longitude first") });
    expect(!result.ok && result.problem).toContain("latitude then longitude");
  });

  it("refuses coordinates outside the city, such as a projected file", () => {
    expect(parse({ type: "Polygon", coordinates: [[[424000, 4512000], [425000, 4512000], [425000, 4513000], [424000, 4512000]]] })).toMatchObject({ ok: false, problem: expect.stringContaining("EPSG:4326") });
    expect(parse({ type: "Polygon", coordinates: [[[-73.99, 40.75], [-73.98, 40.75], [-73.98, 40.76], [-73.99, 40.75]]] })).toMatchObject({ ok: false });
  });

  it("refuses malformed positions and degenerate shapes", () => {
    expect(parse({ type: "Polygon", coordinates: [[[-111.9, "40.76"], [-111.89, 40.76], [-111.89, 40.77]]] })).toMatchObject({ ok: false, problem: "A position is not a pair of numbers." });
    expect(parse({ type: "Polygon", coordinates: [[[-111.9, 40.76], [-111.89, 40.76]]] })).toMatchObject({ ok: false, problem: expect.stringContaining("three distinct corners") });
    expect(parse({ type: "Polygon", coordinates: [[[-111.9, 40.76], [-111.89, 40.76], [-111.88, 40.76], [-111.9, 40.76]]] })).toMatchObject({ ok: false, problem: "A polygon has no area." });
    expect(parse({ type: "Polygon", coordinates: [] })).toMatchObject({ ok: false });
    expect(parse({ type: "Polygon", coordinates: "none" })).toMatchObject({ ok: false });
  });

  it("refuses a file that is too large or too detailed", () => {
    expect(parseZoneGeoJson(" ".repeat(200_001))).toMatchObject({ ok: false, problem: expect.stringContaining("200 KB") });
    const circle = Array.from({ length: 2001 }, (_, i) => [-111.9 + 0.01 * Math.cos(i / 318), 40.76 + 0.01 * Math.sin(i / 318)]);
    expect(parse({ type: "Polygon", coordinates: [circle] })).toMatchObject({ ok: false, problem: expect.stringContaining("2000 corners") });
    expect(parse({ type: "MultiPolygon", coordinates: Array.from({ length: 51 }, () => [ring]) })).toMatchObject({ ok: false, problem: expect.stringContaining("limit is 50") });
  });
});
