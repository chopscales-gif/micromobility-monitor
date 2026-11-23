"use client";

import { H3HexagonLayer } from "@deck.gl/geo-layers";
import { ScatterplotLayer } from "@deck.gl/layers";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { latLngToCell } from "h3-js";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { count, duration, timeSeconds, weekdayTime } from "@/lib/format";
import { hexToRgb, operatorHex, OPERATORS, STATE_KEYS, STATES, stateOf, TYPES, ZONE_STYLES, type StateKey } from "@/lib/meaning";
import { addZoneLayers, mapStyle, TILE_BOUNDS } from "./base";
import { buildTimeline, fleetAt, type Placed, type PlaybackData, type Timeline } from "./playback";

type Live = {
  asOf: number;
  operators: { slug: string; name: string }[];
  vehicles: (Placed & { h3: string })[];
  stations: { id: string; name: string; operator: string; lng: number; lat: number; capacity: number | null; available: number | null }[];
  zones: GeoJSON.FeatureCollection;
};

type View = "vehicles" | "density" | "origins" | "destinations";
type Battery = "all" | "low" | "mid" | "high";

const VIEWS: { key: View; label: string; hint: string }[] = [
  { key: "vehicles", label: "Vehicles", hint: "Each vehicle, where it is now" },
  { key: "density", label: "Density", hint: "Vehicles per block-sized hexagon" },
  { key: "origins", label: "Trip starts", hint: "Where rides began" },
  { key: "destinations", label: "Trip ends", hint: "Where rides finished" },
];
const BATTERY: { key: Battery; label: string; test: (b: number | null) => boolean }[] = [
  { key: "all", label: "Any", test: () => true },
  { key: "low", label: "Under 20%", test: (b) => b !== null && b < 20 },
  { key: "mid", label: "20 to 50%", test: (b) => b !== null && b >= 20 && b <= 50 },
  { key: "high", label: "Over 50%", test: (b) => b !== null && b > 50 },
];

// Lightness only, so a count never borrows the colour of a status or an operator: the lighter the hexagon, the more it holds.
// One step per class the breaks below can make, running the full range from #3b444c to #e9eff5.
const RAMP = ["#fde3d3", "#f9bd9d", "#f09263", "#dc6430", "#a8400f"].map(hexToRgb);
const REFRESH_MS = 30_000;
const WINDOW_S = 24 * 3600;

/** Breaks that put roughly equal numbers of hexagons in each colour, so one busy corner does not wash out the rest. */
function breaks(values: number[]): number[] {
  if (values.length === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  return [...new Set([at(0.4), at(0.65), at(0.85), at(0.96)])];
}
/** Vehicle codes and names come from operators' feeds, so they are never trusted as markup. */
const esc = (text: unknown) => String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const rampIndex = (n: number, cuts: number[]) => {
  let i = 0;
  while (i < cuts.length && n > cuts[i]!) i++;
  return Math.min(i, RAMP.length - 1);
};

/** A filter that is also the legend for the dots, so `color` is the fixed map colour (a `hex` field). */
function Toggle({ on, onClick, color, shape = "circle", label, value, hint }: { on: boolean; onClick: () => void; color: string; shape?: "circle" | "diamond" | "square"; label: string; value?: number; hint?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      title={hint}
      className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors ${on ? "bg-raise" : "text-dim opacity-60 hover:opacity-100"}`}
    >
      <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 ${shape === "circle" ? "rounded-full" : shape === "diamond" ? "rotate-45" : ""}`} style={{ background: on ? color : "transparent", boxShadow: `inset 0 0 0 2px ${color}` }} />
      <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
      {value !== undefined && <span className="font-semibold">{count(value)}</span>}
    </button>
  );
}

function Segments<T extends string>({ value, options, onChange, label }: { value: T; options: { key: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex rounded-lg border border-line bg-ink p-0.5">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={value === o.key}
          onClick={() => onChange(o.key)}
          className={`flex-1 whitespace-nowrap rounded-md px-2 py-1.5 text-[0.8125rem] transition-colors ${value === o.key ? "bg-raise font-semibold text-text shadow-[var(--shadow-sm)]" : "text-dim hover:text-text"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function MapConsole({ viewerOperator }: { viewerOperator: string | null }) {
  const holder = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const overlay = useRef<MapboxOverlay | null>(null);
  const [ready, setReady] = useState(false);

  const [live, setLive] = useState<Live | null>(null);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<View>("vehicles");
  const [colorBy, setColorBy] = useState<"status" | "operator">("status");
  const [hiddenOperators, setHiddenOperators] = useState<Set<string>>(new Set());
  const [type, setType] = useState<"all" | "scooter" | "bicycle">("all");
  const [shownStates, setShownStates] = useState<Set<StateKey>>(new Set(STATE_KEYS.filter((s) => s !== "removed")));
  const [battery, setBattery] = useState<Battery>("all");
  const [showZones, setShowZones] = useState(true);
  const [days, setDays] = useState<"1" | "7" | "30">("7");
  const [tripCells, setTripCells] = useState<{ key: string; cells: [string, number][] } | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [replayLoading, setReplayLoading] = useState(false);
  const [second, setSecond] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<"1" | "2" | "4">("1");

  // --- Data -------------------------------------------------------------------

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const response = await fetch("/api/map/live");
        if (!response.ok) throw new Error(String(response.status));
        const data = (await response.json()) as Live;
        if (!stop) {
          setLive(data);
          setFailed(false);
        }
      } catch {
        if (!stop) setFailed(true);
      }
    };
    load();
    const timer = setInterval(() => document.visibilityState === "visible" && load(), REFRESH_MS);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, []);

  const operators = live?.operators ?? [];
  const selectedOperators = useMemo(() => operators.filter((o) => !hiddenOperators.has(o.slug)).map((o) => o.slug), [operators, hiddenOperators]);

  const tripKey = `${view}|${days}|${selectedOperators.join(",")}|${type}`;
  useEffect(() => {
    if (view !== "origins" && view !== "destinations") return;
    if (selectedOperators.length === 0) return setTripCells({ key: tripKey, cells: [] });
    const abort = new AbortController();
    const query = new URLSearchParams({ kind: view, days });
    if (selectedOperators.length < operators.length) query.set("operators", selectedOperators.join(","));
    if (type !== "all") query.set("type", type);
    fetch(`/api/map/hex?${query}`, { signal: abort.signal })
      .then((r) => r.json())
      .then((data: { cells: [string, number][] }) => setTripCells({ key: tripKey, cells: data.cells }))
      .catch(() => {});
    return () => abort.abort();
  }, [tripKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Replay -------------------------------------------------------------------

  const startReplay = async () => {
    setReplayLoading(true);
    try {
      const data = (await (await fetch("/api/map/playback")).json()) as PlaybackData;
      setTimeline(buildTimeline(data));
      setSecond(0);
      setPlaying(true);
      if (view === "origins" || view === "destinations") setView("vehicles");
    } finally {
      setReplayLoading(false);
    }
  };
  const stopReplay = () => {
    setPlaying(false);
    setTimeline(null);
  };

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      // At normal speed the whole day passes in about a minute and a half.
      const step = ((now - last) / 1000) * 960 * Number(speed);
      last = now;
      setSecond((s) => {
        const next = s + step;
        if (next >= WINDOW_S) {
          setPlaying(false);
          return WINDOW_S;
        }
        return next;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed]);

  // --- What is on screen ----------------------------------------------------------

  const replaySecond = timeline ? Math.floor(second / 20) * 20 : 0;
  const fleet: Placed[] = useMemo(() => (timeline ? fleetAt(timeline, replaySecond) : (live?.vehicles ?? [])), [timeline, replaySecond, live]);

  const batteryTest = BATTERY.find((b) => b.key === battery)!.test;
  const matching = useMemo(
    () => fleet.filter((v) => !hiddenOperators.has(v.operator) && (type === "all" || v.type === type) && batteryTest(v.battery)),
    [fleet, hiddenOperators, type, batteryTest],
  );
  const stateCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const v of matching) counts[v.state] = (counts[v.state] ?? 0) + 1;
    return counts;
  }, [matching]);
  const shown = useMemo(() => matching.filter((v) => shownStates.has(v.state as StateKey)), [matching, shownStates]);

  const densityCells = useMemo(() => {
    if (view !== "density") return [];
    const cells = new Map<string, number>();
    for (const v of shown) {
      const cell = (v as Placed & { h3?: string }).h3 ?? latLngToCell(v.lat, v.lng, 9);
      cells.set(cell, (cells.get(cell) ?? 0) + 1);
    }
    return [...cells];
  }, [view, shown]);

  const hexCells: [string, number][] = view === "density" ? densityCells : view === "vehicles" ? [] : tripCells?.key === tripKey ? tripCells.cells : [];
  const cuts = useMemo(() => breaks(hexCells.map((c) => c[1])), [hexCells]);
  const hexTotal = useMemo(() => hexCells.reduce((sum, c) => sum + c[1], 0), [hexCells]);

  // --- Map --------------------------------------------------------------------------

  useEffect(() => {
    if (!holder.current) return;
    maplibregl.setWorkerUrl(`${window.location.origin}/vendor/maplibre-gl-worker.mjs`);
    const instance = new maplibregl.Map({
      container: holder.current,
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
    });
    instance.touchZoomRotate.disableRotation();
    // Kept clear of the replay bar: the map data licence requires the credit to stay readable.
    instance.addControl(new maplibregl.AttributionControl({ compact: false }), "top-right");
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    const deck = new MapboxOverlay({ interleaved: false, layers: [] });
    instance.addControl(deck);
    instance.on("load", () => setReady(true));
    map.current = instance;
    overlay.current = deck;
    return () => {
      setReady(false);
      instance.remove();
      map.current = null;
      overlay.current = null;
    };
  }, []);

  // Zones are part of the map itself, drawn under the vehicles.
  useEffect(() => {
    const m = map.current;
    if (!ready || !m || !live) return;
    if (!m.getSource("zones")) {
      addZoneLayers(m, live.zones);
      const area = live.zones.features.find((f) => f.properties?.type === "service_area");
      if (area?.geometry.type === "Polygon") {
        const ring = area.geometry.coordinates[0] as [number, number][];
        const lngs = ring.map((c) => c[0]);
        const lats = ring.map((c) => c[1]);
        m.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 48, duration: 0 });
      }
    }
    for (const id of ["zones-fill", "zones-line"]) m.setLayoutProperty(id, "visibility", showZones ? "visible" : "none");
  }, [ready, live, showZones]);

  const tooltip = useCallback(
    ({ object, layer }: { object?: any; layer?: { id: string } | null }) => {
      if (!object || !layer) return null;
      if (layer.id === "vehicles") {
        const v = object as Placed;
        const state = stateOf(v.state);
        const operator = operators.find((o) => o.slug === v.operator)?.name ?? v.operator;
        const at = timeline ? timeline.data.start + replaySecond * 1000 : Date.now();
        return {
          html: `<div style="font-weight:600">${esc(v.code)}</div>
            <div style="color:var(--color-dim)">${esc(operator)} · ${esc(TYPES[v.type] ?? v.type)}</div>
            <div style="margin-top:4px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${state.hex};margin-right:6px"></span>${esc(state.label)} for ${duration(Math.max(0, at - v.since))}</div>
            <div>Battery ${v.battery === null ? "not reported" : `${v.battery}%`}</div>`,
        };
      }
      if (layer.id === "stations") {
        const s = object as Live["stations"][number];
        return { html: `<div style="font-weight:600">${esc(s.name)}</div><div style="color:var(--color-dim)">Dock · ${esc(operators.find((o) => o.slug === s.operator)?.name ?? "")}</div><div>${s.available === null ? "Bikes available not reported" : `${Number(s.available)} bikes available`}${s.capacity ? ` of ${Number(s.capacity)} places` : ""}</div>` };
      }
      if (layer.id === "hexes") {
        const [, n] = object as [string, number];
        const what = view === "density" ? `vehicle${n === 1 ? "" : "s"} here` : view === "origins" ? `trip${n === 1 ? "" : "s"} started here` : `trip${n === 1 ? "" : "s"} ended here`;
        return { html: `<div style="font-weight:600">${count(n)}</div><div style="color:var(--color-dim)">${what}</div>` };
      }
      return null;
    },
    [operators, timeline, replaySecond, view],
  );

  useEffect(() => {
    if (!ready || !overlay.current) return;
    const layers = [];
    if (view === "vehicles") {
      if (!timeline && live && type !== "scooter") {
        layers.push(
          new ScatterplotLayer<Live["stations"][number]>({
            id: "stations",
            data: live.stations.filter((s) => !hiddenOperators.has(s.operator)),
            getPosition: (s) => [s.lng, s.lat],
            getRadius: 26,
            radiusMinPixels: 5,
            radiusMaxPixels: 16,
            stroked: true,
            filled: true,
            getFillColor: [255, 255, 255, 230],
            getLineColor: [...hexToRgb(operatorHex("saltgrass")), 255],
            getLineWidth: 1.5,
            lineWidthUnits: "pixels",
            pickable: true,
          }),
        );
      }
      layers.push(
        new ScatterplotLayer<Placed>({
          id: "vehicles",
          data: shown,
          getPosition: (v) => [v.lng, v.lat],
          getRadius: (v) => (v.type === "bicycle" ? 13 : 10),
          radiusMinPixels: 3.4,
          radiusMaxPixels: 9,
          getFillColor: (v) => [...hexToRgb(colorBy === "status" ? stateOf(v.state).hex : operatorHex(v.operator)), 235] as [number, number, number, number],
          stroked: true,
          // E-bikes carry a dark ring so they can be told from scooters at a glance.
          getLineColor: (v) => (v.type === "bicycle" ? [42, 31, 26, 235] : [255, 255, 255, 255]),
          getLineWidth: (v) => (v.type === "bicycle" ? 1 : 0.75),
          lineWidthUnits: "pixels",
          pickable: true,
          updateTriggers: { getFillColor: [colorBy] },
          transitions: timeline ? undefined : { getPosition: 600 },
        }),
      );
    } else {
      layers.push(
        new H3HexagonLayer<[string, number]>({
          id: "hexes",
          data: hexCells,
          getHexagon: (c) => c[0],
          getFillColor: (c) => [...RAMP[rampIndex(c[1], cuts)]!, 190] as [number, number, number, number],
          getLineColor: [255, 255, 255, 255],
          getLineWidth: 1,
          lineWidthUnits: "pixels",
          stroked: true,
          extruded: false,
          pickable: true,
          highPrecision: false,
          updateTriggers: { getFillColor: [cuts] },
        }),
      );
    }
    overlay.current.setProps({ layers, getTooltip: tooltip as never });
  }, [ready, view, shown, hexCells, cuts, colorBy, live, timeline, hiddenOperators, type, tooltip]);

  // --- Controls -----------------------------------------------------------------------

  const toggleOperator = (slug: string) =>
    setHiddenOperators((current) => {
      const next = new Set(current);
      if (!next.delete(slug)) next.add(slug);
      return next;
    });
  const toggleState = (key: StateKey) =>
    setShownStates((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const operatorCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const v of fleet) if (v.state !== "removed") counts[v.operator] = (counts[v.operator] ?? 0) + 1;
    return counts;
  }, [fleet]);
  const onStreet = matching.filter((v) => v.state !== "removed").length;
  const clock = timeline ? timeline.data.start + replaySecond * 1000 : null;
  const zoneTypes = live ? [...new Set(live.zones.features.map((f) => String(f.properties?.type)))] : [];
  const legendLabels = cuts.length === 0 ? [] : [`1 to ${count(cuts[0]!)}`, ...cuts.slice(1).map((c, i) => `${count(cuts[i]! + 1)} to ${count(c)}`), `over ${count(cuts.at(-1)!)}`];

  return (
    // The whole console is one instrument and is drawn light in either theme, so the dots and zones keep one set of colours.
    <div data-theme="light" className="absolute inset-0 flex flex-col bg-ink text-text lg:flex-row">
      {/* Control rail */}
      <aside
        className={`${panelOpen ? "flex" : "hidden"} absolute inset-x-0 bottom-0 top-12 z-20 flex-col overflow-y-auto border-line bg-panel lg:static lg:flex lg:w-[20.5rem] lg:shrink-0 lg:border-r`}
        aria-label="Map filters"
      >
        <section className="border-b border-line px-4 py-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <h2 className="label">{timeline ? "On the street then" : "On the street now"}</h2>
            <span className="text-[0.8125rem] text-faint">{clock ? weekdayTime(clock) : live ? `read ${timeSeconds(live.asOf)}` : ""}</span>
          </div>
          <p className="figure mt-1.5 text-[2.75rem]">{live ? count(onStreet) : "…"}</p>
          <p className="mt-1 text-[0.8125rem] text-dim">{viewerOperator ? `${viewerOperator} vehicles only` : "vehicles across all operators"}, after the filters below</p>
          <div className="mt-3 space-y-0.5">
            {STATE_KEYS.map((key) => (
              <Toggle key={key} on={shownStates.has(key)} onClick={() => toggleState(key)} color={STATES[key].hex} label={STATES[key].label} hint={STATES[key].hint} value={stateCounts[key] ?? 0} />
            ))}
          </div>
        </section>

        {operators.length > 1 && (
          <section className="border-b border-line px-4 py-4">
            <h2 className="label">Operator</h2>
            <div className="mt-2 space-y-0.5">
              {operators.map((o) => (
                <Toggle key={o.slug} on={!hiddenOperators.has(o.slug)} onClick={() => toggleOperator(o.slug)} color={operatorHex(o.slug)} shape={OPERATORS[o.slug]?.shape} label={o.name} value={operatorCounts[o.slug] ?? 0} />
              ))}
            </div>
          </section>
        )}

        <section className="space-y-3 border-b border-line px-4 py-4">
          <div>
            <h2 className="label mb-1.5">Vehicle type</h2>
            <Segments label="Vehicle type" value={type} onChange={setType} options={[{ key: "all", label: "All" }, { key: "scooter", label: "E-scooters" }, { key: "bicycle", label: "E-bikes" }]} />
          </div>
          <div>
            <h2 className="label mb-1.5">Battery</h2>
            <Segments label="Battery" value={battery} onChange={setBattery} options={BATTERY} />
          </div>
          {view === "vehicles" && (
            <div>
              <h2 className="label mb-1.5">Colour dots by</h2>
              <Segments label="Colour dots by" value={colorBy} onChange={setColorBy} options={[{ key: "status", label: "Status" }, { key: "operator", label: "Operator" }]} />
            </div>
          )}
        </section>

        <section className="px-4 py-4">
          <label className="flex cursor-pointer items-center justify-between">
            <span className="font-medium">Zones</span>
            <input type="checkbox" checked={showZones} onChange={(e) => setShowZones(e.target.checked)} className="h-4 w-4" aria-label="Show zones" />
          </label>
          {showZones && (
            <ul className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[0.8125rem] text-dim">
              {zoneTypes.map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <span aria-hidden="true" className="h-2.5 w-4 shrink-0 border border-dashed" style={{ borderColor: ZONE_STYLES[t]?.hex, background: t === "service_area" || !ZONE_STYLES[t] ? "transparent" : `${ZONE_STYLES[t].hex}30` }} />
                  {ZONE_STYLES[t]?.label ?? t}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2.5 text-[0.8125rem] leading-snug text-faint">Zone boundaries are illustrative, drawn for this demonstration.</p>
        </section>
        <div className="mt-auto p-4 lg:hidden">
          <button type="button" className="btn w-full" onClick={() => setPanelOpen(false)}>
            Show the map
          </button>
        </div>
      </aside>

      {/* Map */}
      <div className="relative min-h-0 flex-1">
        {/* MapLibre makes its container position: relative, so the size comes from a wrapper. */}
        <div className="absolute inset-0">
          <div ref={holder} className="h-full w-full" />
        </div>

        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-wrap items-start gap-2 p-2.5">
          <div className="pointer-events-auto flex max-w-full overflow-x-auto rounded-lg border border-line bg-ink/90 p-0.5 shadow-[var(--shadow-md)] backdrop-blur">
            {VIEWS.map((v) => (
              <button
                key={v.key}
                type="button"
                title={v.hint}
                aria-pressed={view === v.key}
                disabled={!!timeline && (v.key === "origins" || v.key === "destinations")}
                onClick={() => setView(v.key)}
                className={`whitespace-nowrap rounded-md px-3 py-1.5 transition-colors disabled:opacity-30 ${view === v.key ? "bg-raise font-semibold text-text shadow-[var(--shadow-sm)]" : "text-dim hover:text-text"}`}
              >
                {v.label}
              </button>
            ))}
          </div>
          <button type="button" className="btn pointer-events-auto lg:hidden" onClick={() => setPanelOpen(true)}>
            Filters · {count(onStreet)}
          </button>
          {(view === "origins" || view === "destinations") && (
            <div className="pointer-events-auto w-60 max-w-full">
              <Segments label="Period" value={days} onChange={setDays} options={[{ key: "1", label: "24 hours" }, { key: "7", label: "7 days" }, { key: "30", label: "30 days" }]} />
            </div>
          )}
        </div>

        {view !== "vehicles" && (
          <div className="panel absolute bottom-[5.25rem] left-2.5 z-10 w-56 max-w-[calc(100%-4.5rem)] p-3">
            <p className="font-medium">{view === "density" ? "Vehicles per hexagon" : view === "origins" ? "Trip starts per hexagon" : "Trip ends per hexagon"}</p>
            {hexCells.length === 0 ? (
              <p className="mt-2 text-[0.8125rem] text-dim">{view !== "density" && tripCells?.key !== tripKey ? "Counting trips…" : "Nothing matches the filters."}</p>
            ) : (
              <>
                <ul className="mt-2 space-y-1">
                  {legendLabels.map((label, i) => (
                    <li key={label} className="flex items-center gap-2 text-[0.8125rem]">
                      <span aria-hidden="true" className="h-3 w-5 rounded-sm" style={{ background: `rgb(${RAMP[i]!.join(",")})` }} />
                      <span>{label}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[0.8125rem] leading-snug text-faint">
                  The lighter the hexagon, the more it holds. {count(hexTotal)} {view === "density" ? "vehicles" : "trips"} in {count(hexCells.length)} hexagons, each about 175 m across.
                </p>
              </>
            )}
          </div>
        )}

        {/* Replay */}
        <div className="absolute inset-x-2.5 bottom-2.5 z-10 mr-12">
          {timeline ? (
            <div className="panel flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
              <button type="button" className="btn btn-signal w-20" onClick={() => (second >= WINDOW_S ? (setSecond(0), setPlaying(true)) : setPlaying((p) => !p))}>
                {playing ? "Pause" : second >= WINDOW_S ? "Again" : "Play"}
              </button>
              <div className="min-w-[10rem] flex-1">
                <input
                  type="range"
                  min={0}
                  max={WINDOW_S}
                  step={300}
                  value={Math.round(second)}
                  onChange={(e) => {
                    setPlaying(false);
                    setSecond(Number(e.target.value));
                  }}
                  aria-label="Time of day"
                  className="block w-full"
                />
                <div className="mt-0.5 flex justify-between text-[0.8125rem] text-faint">
                  <span>{weekdayTime(timeline.data.start)}</span>
                  <span>{weekdayTime(timeline.data.end)}</span>
                </div>
              </div>
              <p className="w-36 text-center text-lg font-semibold">{weekdayTime(clock!)}</p>
              <div className="w-28">
                <Segments label="Speed" value={speed} onChange={setSpeed} options={[{ key: "1", label: "1×" }, { key: "2", label: "2×" }, { key: "4", label: "4×" }]} />
              </div>
              <button type="button" className="btn" onClick={stopReplay}>
                Back to live
              </button>
            </div>
          ) : (
            <button type="button" className="btn" onClick={startReplay} disabled={replayLoading || !live}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                <path d="M2 1.2v9.6a.6.6 0 0 0 .9.5l8-4.8a.6.6 0 0 0 0-1L2.9.7a.6.6 0 0 0-.9.5Z" />
              </svg>
              {replayLoading ? "Loading the last 24 hours…" : "Replay the last 24 hours"}
            </button>
          )}
        </div>

        {failed && (
          <div className="panel absolute left-1/2 top-16 z-20 w-max max-w-[calc(100%-1.25rem)] -translate-x-1/2 px-3 py-2">
            <p className="flash text-poor">
              <span>Could not read the latest positions. Trying again shortly.</span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
