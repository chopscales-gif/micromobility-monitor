// Small planar-enough geometry helpers. Downtown Salt Lake City is a few
// kilometres across, so an equirectangular approximation is accurate to well
// under a metre and keeps this dependency-free.

export type LngLat = [lng: number, lat: number];
/** A GeoJSON-style polygon: outer ring first, then holes. Rings are closed. */
export type Polygon = LngLat[][];

const EARTH_RADIUS_M = 6_371_008.8;
const RAD = Math.PI / 180;

export function distanceMeters(a: LngLat, b: LngLat): number {
  const x = (b[0] - a[0]) * RAD * Math.cos(((a[1] + b[1]) / 2) * RAD);
  const y = (b[1] - a[1]) * RAD;
  return Math.sqrt(x * x + y * y) * EARTH_RADIUS_M;
}

function inRing(point: LngLat, ring: LngLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > point[1] !== yj > point[1] && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function pointInPolygon(point: LngLat, polygon: Polygon): boolean {
  const [outer, ...holes] = polygon;
  if (!outer || !inRing(point, outer)) return false;
  return !holes.some((hole) => inRing(point, hole));
}

export function lineLengthMeters(line: LngLat[]): number {
  let total = 0;
  for (let i = 1; i < line.length; i++) total += distanceMeters(line[i - 1]!, line[i]!);
  return total;
}

/** Distance from a point to the segment a-b, in metres. */
function segmentDistanceMeters(point: LngLat, a: LngLat, b: LngLat): number {
  const scale = Math.cos(point[1] * RAD);
  const [px, py] = [(point[0] - a[0]) * scale, point[1] - a[1]];
  const [bx, by] = [(b[0] - a[0]) * scale, b[1] - a[1]];
  const length = bx * bx + by * by;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / length));
  return distanceMeters(point, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
}

/** How far a point is from the nearest edge of any of the polygons, whichever side of it the point is on. */
export function boundaryDistanceMeters(point: LngLat, polygons: Polygon[]): number {
  let nearest = Infinity;
  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (let i = 1; i < ring.length; i++) nearest = Math.min(nearest, segmentDistanceMeters(point, ring[i - 1]!, ring[i]!));
    }
  }
  return nearest;
}
