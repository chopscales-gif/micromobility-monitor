import { describe, expect, it } from "vitest";
import { distanceMeters, lineLengthMeters, pointInPolygon, type Polygon } from "./geo";

const square: Polygon = [[[-111.9, 40.76], [-111.89, 40.76], [-111.89, 40.77], [-111.9, 40.77], [-111.9, 40.76]]];
const donut: Polygon = [...square, [[-111.897, 40.763], [-111.893, 40.763], [-111.893, 40.767], [-111.897, 40.767], [-111.897, 40.763]]];

describe("geo", () => {
  it("measures one Salt Lake City block pitch (792 ft) to within a metre", () => {
    // Main St & 100 S to Main St & 200 S.
    expect(distanceMeters([-111.89105, 40.767275], [-111.89105, 40.7651])).toBeCloseTo(241.8, 0);
  });
  it("finds points inside and outside a polygon", () => {
    expect(pointInPolygon([-111.895, 40.765], square)).toBe(true);
    expect(pointInPolygon([-111.885, 40.765], square)).toBe(false);
    expect(pointInPolygon([-111.895, 40.775], square)).toBe(false);
  });
  it("respects holes", () => {
    expect(pointInPolygon([-111.895, 40.765], donut)).toBe(false);
    expect(pointInPolygon([-111.899, 40.761], donut)).toBe(true);
  });
  it("sums line length", () => {
    const line: [number, number][] = [[-111.9, 40.76], [-111.9, 40.77], [-111.89, 40.77]];
    expect(lineLengthMeters(line)).toBeCloseTo(distanceMeters(line[0]!, line[1]!) + distanceMeters(line[1]!, line[2]!));
  });
});
