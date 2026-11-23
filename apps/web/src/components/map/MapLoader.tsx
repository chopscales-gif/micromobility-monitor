"use client";

import dynamic from "next/dynamic";

// The map draws with WebGL, so it only ever runs in the browser.
const MapConsole = dynamic(() => import("./MapConsole"), {
  ssr: false,
  // Dark from the first paint, like the console that replaces it.
  loading: () => (
    <p data-theme="light" className="absolute inset-0 grid place-items-center bg-ink text-dim">
      Loading the map…
    </p>
  ),
});

export function MapLoader({ viewerOperator }: { viewerOperator: string | null }) {
  return <MapConsole viewerOperator={viewerOperator} />;
}
