// What every map in the console shares: the basemap, its limits, and how zones are drawn.

import { layers as basemapLayers, namedFlavor } from "@protomaps/basemaps";
import * as maplibregl from "maplibre-gl";
import { ZONE_STYLES } from "@/lib/meaning";

// The basemap tiles shipped with the app cover this box and nothing else.
export const TILE_BOUNDS: [number, number, number, number] = [-112.0, 40.7, -111.77, 40.82];

export function mapStyle(): maplibregl.StyleSpecification {
  const origin = window.location.origin;
  const flavor = { ...namedFlavor("light"), background: "#f3efea", earth: "#f8f5f1", water: "#cfe3ee", buildings: "#ebe4dc" };
  return {
    version: 8,
    glyphs: `${origin}/basemap/fonts/{fontstack}/{range}.pbf`,
    sprite: `${origin}/basemap/sprites/light`,
    sources: {
      protomaps: {
        type: "vector",
        tiles: [`${origin}/basemap/{z}/{x}/{y}.mvt`],
        minzoom: 9,
        maxzoom: 15,
        bounds: TILE_BOUNDS,
        attribution: '<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>',
      },
    },
    layers: basemapLayers("protomaps", flavor, { lang: "en" }) as maplibregl.LayerSpecification[],
  };
}

/** A map of the city with the console's usual limits. The caller removes it when done. */
export function createMap(container: HTMLElement, options: Partial<maplibregl.MapOptions> = {}): maplibregl.Map {
  maplibregl.setWorkerUrl(`${window.location.origin}/vendor/maplibre-gl-worker.mjs`);
  const map = new maplibregl.Map({
    container,
    style: mapStyle(),
    center: [-111.889, 40.759],
    zoom: 12.7,
    minZoom: 11,
    maxZoom: 17.5,
    maxBounds: [
      [TILE_BOUNDS[0], TILE_BOUNDS[1]],
      [TILE_BOUNDS[2], TILE_BOUNDS[3]],
    ],
    attributionControl: false,
    dragRotate: false,
    pitchWithRotate: false,
    ...options,
  });
  map.touchZoomRotate.disableRotation();
  // The map data licence requires the credit to stay readable.
  map.addControl(new maplibregl.AttributionControl({ compact: false }), "top-right");
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
  return map;
}

// The canvas cannot read CSS variables, so it takes the fixed map colours.
const ZONE_COLOR = ["match", ["get", "type"], ...Object.entries(ZONE_STYLES).flatMap(([key, z]) => [key, z.hex]), "#888888"] as unknown as maplibregl.ExpressionSpecification;

/** Draws policy zones under whatever else the map shows. Call once the map has loaded. */
export function addZoneLayers(map: maplibregl.Map, zones: GeoJSON.FeatureCollection, { labels = false } = {}) {
  map.addSource("zones", { type: "geojson", data: zones });
  map.addLayer({ id: "zones-fill", type: "fill", source: "zones", filter: ["!=", ["get", "type"], "service_area"], paint: { "fill-color": ZONE_COLOR, "fill-opacity": 0.16 } });
  map.addLayer({
    id: "zones-line",
    type: "line",
    source: "zones",
    paint: { "line-color": ZONE_COLOR, "line-width": ["case", ["==", ["get", "type"], "service_area"], 2, 1.5], "line-opacity": 0.9, "line-dasharray": [3, 2] },
  });
  if (labels) {
    map.addLayer({
      id: "zones-label",
      type: "symbol",
      source: "zones",
      filter: ["!=", ["get", "type"], "service_area"],
      layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Medium"], "text-size": 11, "text-max-width": 9 },
      paint: { "text-color": ZONE_COLOR, "text-halo-color": "#ffffff", "text-halo-width": 1.5 },
    });
  }
}

/** The box around a set of positions, for fitting the map to them. */
export function boundsOf(points: [number, number][]): [[number, number], [number, number]] {
  const lngs = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];
}

/** Every corner of a polygon or multipolygon geometry. */
export function corners(geometry: GeoJSON.Geometry): [number, number][] {
  if (geometry.type === "Polygon") return geometry.coordinates.flat() as [number, number][];
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flat(2) as [number, number][];
  return [];
}
