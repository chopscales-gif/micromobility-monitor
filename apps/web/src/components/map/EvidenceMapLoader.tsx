"use client";

import dynamic from "next/dynamic";
import type { EvidencePoint } from "./EvidenceMap";

// The map draws with WebGL, so it only ever runs in the browser.
const EvidenceMap = dynamic(() => import("./EvidenceMap"), {
  ssr: false,
  loading: () => <p className="grid h-full place-items-center text-dim">Loading the map…</p>,
});

export function EvidenceMapLoader(props: { zones: GeoJSON.FeatureCollection; points: EvidencePoint[] }) {
  return <EvidenceMap {...props} />;
}
