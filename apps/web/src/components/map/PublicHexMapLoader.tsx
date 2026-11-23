"use client";

import dynamic from "next/dynamic";
import type { PublicCell } from "@/server/open-data";

// The map draws with WebGL, so it only ever runs in the browser.
const PublicHexMap = dynamic(() => import("./PublicHexMap"), {
  ssr: false,
  loading: () => <p className="grid h-[26rem] place-items-center text-dim">Loading the map…</p>,
});

export function PublicHexMapLoader(props: { starts: PublicCell[]; ends: PublicCell[] }) {
  return <PublicHexMap {...props} />;
}
