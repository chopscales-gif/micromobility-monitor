"use client";

import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import { addZoneLayers, boundsOf, createMap } from "./base";

/** `color` is painted on the canvas, so it must be a fixed hex (a `hex` field), never a CSS variable. */
export type EvidencePoint = { lng: number; lat: number; label: string; sub: string; color: string };

/** Where the vehicles in a finding stood, over the zones in force at the time. */
export default function EvidenceMap({ zones, points }: { zones: GeoJSON.FeatureCollection; points: EvidencePoint[] }) {
  const holder = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!holder.current) return;
    const map = createMap(holder.current, { cooperativeGestures: true });
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10, className: "evidence-popup" });
    map.on("load", () => {
      addZoneLayers(map, zones, { labels: true });
      map.addSource("points", {
        type: "geojson",
        data: { type: "FeatureCollection", features: points.map((p) => ({ type: "Feature", geometry: { type: "Point", coordinates: [p.lng, p.lat] }, properties: p })) },
      });
      map.addLayer({ id: "points-halo", type: "circle", source: "points", paint: { "circle-radius": 11, "circle-color": ["get", "color"], "circle-opacity": 0.22 } });
      map.addLayer({ id: "points", type: "circle", source: "points", paint: { "circle-radius": 5.5, "circle-color": ["get", "color"], "circle-stroke-color": "#0c0f12", "circle-stroke-width": 1.5 } });
      if (points.length === 1) map.jumpTo({ center: [points[0]!.lng, points[0]!.lat], zoom: 15.6 });
      else if (points.length > 1) map.fitBounds(boundsOf(points.map((p) => [p.lng, p.lat])), { padding: 56, maxZoom: 16, duration: 0 });

      const show = (event: maplibregl.MapLayerMouseEvent) => {
        const feature = event.features?.[0];
        if (!feature || feature.geometry.type !== "Point") return;
        // Vehicle codes come from operators' feeds, so they are set as text, never as markup.
        const body = document.createElement("div");
        const label = document.createElement("strong");
        label.textContent = String(feature.properties.label);
        const sub = document.createElement("span");
        sub.textContent = String(feature.properties.sub);
        body.append(label, sub);
        popup.setLngLat(feature.geometry.coordinates as [number, number]).setDOMContent(body).addTo(map);
      };
      map.on("mousemove", "points", (event) => {
        map.getCanvas().style.cursor = "pointer";
        show(event);
      });
      map.on("click", "points", show);
      map.on("mouseleave", "points", () => {
        map.getCanvas().style.cursor = "";
        popup.remove();
      });
    });
    return () => map.remove();
  }, [zones, points]);

  return <div ref={holder} className="h-full w-full" role="img" aria-label={`Map of ${points.length} vehicle position${points.length === 1 ? "" : "s"}. The same positions are listed in the table on this page.`} />;
}
