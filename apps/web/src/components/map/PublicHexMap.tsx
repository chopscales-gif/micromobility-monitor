"use client";

import { cellToBoundary } from "h3-js";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { count } from "@/lib/format";
import type { PublicCell } from "@/server/open-data";
import { boundsOf, createMap } from "./base";

// The same pale-is-busy ramp as the console's own maps.
const RAMP = ["#3b444c", "#676f76", "#929aa1", "#bec4cb", "#e9eff5"];

/** Class breaks that put about the same number of hexagons in each step of the ramp. */
function breaks(cells: PublicCell[]): number[] {
  const sorted = cells.map((c) => c.trips).sort((a, b) => a - b);
  if (sorted.length < RAMP.length) return [];
  const round = (n: number) => (n >= 1000 ? Math.round(n / 100) * 100 : n >= 100 ? Math.round(n / 10) * 10 : n);
  const cuts = [1, 2, 3, 4].map((i) => round(sorted[Math.floor((sorted.length * i) / RAMP.length)]!));
  return [...new Set(cuts)];
}

const featuresOf = (cells: PublicCell[], cuts: number[]): GeoJSON.FeatureCollection => ({
  type: "FeatureCollection",
  features: cells.map((c) => ({
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [cellToBoundary(c.h3, true)] },
    properties: { trips: c.trips, color: RAMP[Math.min(cuts.filter((cut) => c.trips > cut).length, RAMP.length - 1)]! },
  })),
});

/** Where rides began or ended, as published: hexagons about 900 metres across, none holding fewer than ten rides. */
export default function PublicHexMap({ starts, ends }: { starts: PublicCell[]; ends: PublicCell[] }) {
  const holder = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [end, setEnd] = useState<"starts" | "ends">("starts");
  const cells = end === "starts" ? starts : ends;
  const cuts = useMemo(() => breaks(cells), [cells]);
  const data = useMemo(() => featuresOf(cells, cuts), [cells, cuts]);
  const latest = useRef({ data, end });
  latest.current = { data, end };

  useEffect(() => {
    if (!holder.current) return;
    const map = createMap(holder.current, { cooperativeGestures: true, zoom: 11.6 });
    mapRef.current = map;
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10, className: "evidence-popup" });
    map.on("load", () => {
      map.addSource("cells", { type: "geojson", data: latest.current.data });
      map.addLayer({ id: "cells", type: "fill", source: "cells", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.72, "fill-outline-color": "#0c0f12" } });
      const all = [...starts, ...ends].map((c) => [c.lng, c.lat] as [number, number]);
      if (all.length > 1) map.fitBounds(boundsOf(all), { padding: 36, duration: 0 });
      const show = (event: maplibregl.MapLayerMouseEvent) => {
        const feature = event.features?.[0];
        if (!feature) return;
        const body = document.createElement("div");
        const label = document.createElement("strong");
        label.textContent = `${count(Number(feature.properties.trips))} rides`;
        const sub = document.createElement("span");
        sub.textContent = latest.current.end === "starts" ? "began in this area" : "ended in this area";
        body.append(label, sub);
        popup.setLngLat(event.lngLat).setDOMContent(body).addTo(map);
      };
      map.on("mousemove", "cells", show);
      map.on("click", "cells", show);
      map.on("mouseleave", "cells", () => popup.remove());
    });
    return () => {
      mapRef.current = null;
      map.remove();
    };
  }, [starts, ends]);

  useEffect(() => {
    const source = mapRef.current?.getSource("cells") as maplibregl.GeoJSONSource | undefined;
    source?.setData(data);
  }, [data]);

  const labels = cuts.length === 0 ? [] : [`10 to ${count(cuts[0]!)}`, ...cuts.slice(1).map((c, i) => `${count(cuts[i]! + 1)} to ${count(c)}`), `over ${count(cuts.at(-1)!)}`];
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3">
        <div className="flex rounded-lg border border-line bg-raise p-0.5" role="group" aria-label="Which end of the ride to show">
          {(["starts", "ends"] as const).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={end === key}
              onClick={() => setEnd(key)}
              className={`cursor-pointer whitespace-nowrap rounded-md px-3 py-1.5 text-[0.8125rem] ${end === key ? "bg-panel font-semibold text-text shadow-[var(--shadow-sm)]" : "text-dim hover:text-text"}`}
            >
              {key === "starts" ? "Where rides began" : "Where rides ended"}
            </button>
          ))}
        </div>
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.8125rem] text-dim" aria-label="Rides in the month, per hexagon">
          {labels.map((label, i) => (
            <li key={label} className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <span aria-hidden="true" className="h-3 w-5 rounded-sm border border-rule" style={{ background: RAMP[i] }} />
              {label}
            </li>
          ))}
        </ul>
      </div>
      <div data-theme="dark" className="h-[26rem] overflow-hidden rounded-lg border border-line">
        <div ref={holder} className="h-full w-full" role="img" aria-label={`Map of where rides ${end === "starts" ? "began" : "ended"}, in ${cells.length} hexagons. The same counts are in the download below.`} />
      </div>
    </div>
  );
}
