"use client";

import type { LngLat, Polygon } from "@mm/core/geo";
import { parseZoneGeoJson, SLOW_ZONE_LIMITS, ZONE_EFFECTS, ZONE_LABELS, ZONE_NAME_MAX, ZONE_TYPES, type ZoneType } from "@mm/core/zones";
import type * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { ZONE_STYLES } from "@/lib/meaning";
import { addZoneLayers, boundsOf, corners, createMap } from "./base";

type Mode = "idle" | "draw" | "upload";

/** True when two edges of the outline cross, which makes it no shape at all. */
function crossesItself(points: LngLat[]): boolean {
  const n = points.length;
  if (n < 4) return false;
  const turn = (a: LngLat, b: LngLat, c: LngLat) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // neighbours across the closing edge
      const [a, b, c, d] = [points[i]!, points[(i + 1) % n]!, points[j]!, points[(j + 1) % n]!];
      if (turn(a, b, c) !== turn(a, b, d) && turn(c, d, a) !== turn(c, d, b)) return true;
    }
  }
  return false;
}

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
// The shape being drawn, in fixed colours for the canvas (the text beside the map calls it orange).
const DRAFT = "#e2531c";
const DRAFT_CORE = "#ffffff";

export default function ZoneEditor({ zones, canEdit, adopt }: { zones: GeoJSON.FeatureCollection; canEdit: boolean; adopt: (formData: FormData) => void | Promise<void> }) {
  const holder = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);

  const [mode, setMode] = useState<Mode>("idle");
  const [points, setPoints] = useState<LngLat[]>([]);
  const [upload, setUpload] = useState<{ file: string; polygons: Polygon[]; vertices: number } | null>(null);
  const [uploadProblem, setUploadProblem] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<ZoneType>("no_parking");
  const drawing = useRef(false);
  drawing.current = mode === "draw";

  useEffect(() => {
    if (!holder.current) return;
    const instance = createMap(holder.current, { cooperativeGestures: true });
    instance.on("load", () => {
      addZoneLayers(instance, zones, { labels: true });
      const all = zones.features.flatMap((f) => corners(f.geometry));
      if (all.length > 0) instance.fitBounds(boundsOf(all), { padding: 40, duration: 0 });
      instance.addSource("draft", { type: "geojson", data: EMPTY });
      instance.addLayer({ id: "draft-fill", type: "fill", source: "draft", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": DRAFT, "fill-opacity": 0.22 } });
      instance.addLayer({ id: "draft-line", type: "line", source: "draft", filter: ["!=", ["geometry-type"], "Point"], paint: { "line-color": DRAFT, "line-width": 2.5 } });
      instance.addLayer({ id: "draft-points", type: "circle", source: "draft", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 5, "circle-color": DRAFT_CORE, "circle-stroke-color": DRAFT, "circle-stroke-width": 2.5 } });
      setReady(true);
    });
    instance.on("click", (event) => {
      if (drawing.current) setPoints((before) => [...before, [Number(event.lngLat.lng.toFixed(6)), Number(event.lngLat.lat.toFixed(6))]]);
    });
    map.current = instance;
    return () => {
      setReady(false);
      instance.remove();
      map.current = null;
    };
  }, [zones]);

  const crossed = useMemo(() => crossesItself(points), [points]);
  const polygons: Polygon[] | null = mode === "draw" ? (points.length >= 3 && !crossed ? [[[...points, points[0]!]]] : null) : mode === "upload" ? (upload?.polygons ?? null) : null;

  // The shape being drawn or previewed, on top of the adopted zones.
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    const features: GeoJSON.Feature[] = [];
    if (mode === "draw") {
      if (points.length >= 3) features.push({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[...points, points[0]!]] } });
      else if (points.length === 2) features.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: points } });
      for (const p of points) features.push({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: p } });
    } else if (mode === "upload" && upload) {
      features.push({ type: "Feature", properties: {}, geometry: { type: "MultiPolygon", coordinates: upload.polygons } });
    }
    (m.getSource("draft") as maplibregl.GeoJSONSource).setData({ type: "FeatureCollection", features });
    m.getCanvas().style.cursor = mode === "draw" ? "crosshair" : "";
    if (mode === "draw") m.doubleClickZoom.disable();
    else m.doubleClickZoom.enable();
    if (mode === "upload" && upload) m.fitBounds(boundsOf(upload.polygons.flat(2) as [number, number][]), { padding: 60, maxZoom: 16 });
  }, [ready, mode, points, upload]);

  const start = (next: Mode) => {
    setMode(next);
    setPoints([]);
    setUpload(null);
    setUploadProblem(null);
  };

  const readFile = async (file: File | undefined) => {
    setUpload(null);
    setUploadProblem(null);
    if (!file) return;
    if (file.size > 200_000) return setUploadProblem("The file is larger than 200 KB. Simplify the shape and try again.");
    const parsed = parseZoneGeoJson(await file.text());
    if (!parsed.ok) return setUploadProblem(parsed.problem);
    setUpload({ file: file.name, polygons: parsed.polygons, vertices: parsed.vertices });
    if (parsed.name && !name) setName(parsed.name);
  };

  return (
    <div className={`grid items-start gap-6 ${canEdit ? "lg:grid-cols-[minmax(0,1fr)_23rem]" : ""}`}>
      {/* The map and its key are drawn light in either theme, so zones keep one set of colours. */}
      <div data-theme="light" className="min-w-0 overflow-hidden rounded-xl bg-ink text-text shadow-[var(--shadow-md)]">
        <div className="relative h-[24rem] sm:h-[34rem]">
          <div ref={holder} className="h-full w-full" role="application" aria-label="Map of the city's policy zones. The same zones are listed below the map." />
          {mode === "draw" && (
            <p className="pointer-events-none absolute left-3 top-3 max-w-[15rem] rounded-lg border border-rule bg-ink/90 px-3 py-2 text-[0.8125rem] font-medium leading-snug shadow-[var(--shadow-md)]">
              {points.length === 0 ? "Click the map to place the first corner." : points.length < 3 ? `${points.length} of at least 3 corners placed.` : "Keep clicking to add corners, in order around the edge."}
            </p>
          )}
        </div>
        <ul className="flex flex-wrap gap-x-5 gap-y-1.5 border-t border-line px-4 py-3 text-[0.8125rem] text-dim">
          {ZONE_TYPES.map((t) => (
            <li key={t} className="flex items-center gap-1.5">
              <span aria-hidden="true" className="h-2.5 w-4 shrink-0 border border-dashed" style={{ borderColor: ZONE_STYLES[t]?.hex, background: t === "service_area" || !ZONE_STYLES[t] ? "transparent" : `${ZONE_STYLES[t].hex}30` }} />
              {ZONE_LABELS[t]}
            </li>
          ))}
        </ul>
      </div>

      {canEdit && (
        <section className="panel p-6">
          <h2 className="heading">Add a zone</h2>
          {mode === "idle" ? (
            <>
              <p className="mt-3 text-dim">A new zone is in force from the moment it is adopted. Rides and parking before then are not judged against it.</p>
              <div className="mt-4 grid gap-2">
                <button type="button" className="btn btn-signal" onClick={() => start("draw")}>
                  Draw on the map
                </button>
                <button type="button" className="btn" onClick={() => start("upload")}>
                  Upload a GeoJSON file
                </button>
              </div>
            </>
          ) : (
            <form action={adopt} className="mt-4 space-y-5">
              <input type="hidden" name="source" value={mode === "upload" ? "upload" : "drawn"} />
              <input type="hidden" name="shape" value={polygons ? JSON.stringify({ type: "MultiPolygon", coordinates: polygons }) : ""} />

              <div>
                <p className="font-semibold">1. {mode === "draw" ? "Mark the corners on the map" : "Choose the file"}</p>
                {mode === "draw" ? (
                  <div className="mt-2">
                    <p>
                      <strong className="font-semibold">{points.length}</strong> <span className="text-dim">corner{points.length === 1 ? "" : "s"} placed</span>
                    </p>
                    {crossed && (
                      <p className="flash mt-2 text-[0.8125rem] text-poor">
                        <span>The outline crosses itself. Undo the last corner and place the corners in order around the edge.</span>
                      </p>
                    )}
                    <p className="mt-2 flex gap-2">
                      <button type="button" className="btn flex-1 disabled:cursor-not-allowed disabled:opacity-40" disabled={points.length === 0} onClick={() => setPoints((before) => before.slice(0, -1))}>
                        Undo corner
                      </button>
                      <button type="button" className="btn flex-1 disabled:cursor-not-allowed disabled:opacity-40" disabled={points.length === 0} onClick={() => setPoints([])}>
                        Clear
                      </button>
                    </p>
                  </div>
                ) : (
                  <div className="mt-2">
                    <input type="file" accept=".geojson,.json,application/geo+json,application/json" aria-label="GeoJSON file" onChange={(event) => readFile(event.target.files?.[0])} className="block w-full text-[0.8125rem] text-dim file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-rule file:bg-raise file:px-3 file:py-1.5 file:text-[0.8125rem] file:font-medium file:text-text" />
                    <p className="mt-2 text-[0.8125rem] text-dim">A Polygon, MultiPolygon, Feature or FeatureCollection in longitude, latitude order (WGS 84), inside the city.</p>
                    {uploadProblem && (
                      <p className="flash mt-2 text-[0.8125rem] text-poor">
                        <span>{uploadProblem}</span>
                      </p>
                    )}
                    {upload && (
                      <p className="flash mt-2 text-[0.8125rem] text-good">
                        <span>
                          {upload.file}: {upload.polygons.length} polygon{upload.polygons.length === 1 ? "" : "s"}, {upload.vertices} points. Shown on the map in orange.
                        </span>
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div>
                <p className="font-semibold">2. Say what it is</p>
                <div className="mt-2 space-y-3">
                  <label className="block">
                    <span className="label">Name</span>
                    <input name="name" required maxLength={ZONE_NAME_MAX} value={name} onChange={(event) => setName(event.target.value)} className="field mt-1" placeholder="For example: Pioneer Park paths" />
                  </label>
                  <label className="block">
                    <span className="label">Kind of zone</span>
                    <select name="type" value={type} onChange={(event) => setType(event.target.value as ZoneType)} className="field mt-1">
                      {ZONE_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {ZONE_LABELS[t]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="note text-[0.8125rem] text-dim">{ZONE_EFFECTS[type]}</p>
                  {type === "slow_ride" && (
                    <label className="block">
                      <span className="label">
                        Speed limit, km/h ({SLOW_ZONE_LIMITS.min} to {SLOW_ZONE_LIMITS.max})
                      </span>
                      <input name="speedLimitKph" type="number" inputMode="numeric" required min={SLOW_ZONE_LIMITS.min} max={SLOW_ZONE_LIMITS.max} step={1} defaultValue={13} className="field mt-1" />
                    </label>
                  )}
                </div>
              </div>

              <div className="grid gap-2 border-t border-line pt-4">
                <button type="submit" className="btn btn-signal disabled:cursor-not-allowed disabled:opacity-40" disabled={!polygons}>
                  Adopt this zone
                </button>
                <button type="button" className="btn" onClick={() => start("idle")}>
                  Cancel
                </button>
                {!polygons && <p className="text-[0.8125rem] text-dim">{mode === "draw" ? "Place at least three corners to adopt the zone." : "Choose a file to adopt the zone."}</p>}
              </div>
            </form>
          )}
        </section>
      )}
    </div>
  );
}
