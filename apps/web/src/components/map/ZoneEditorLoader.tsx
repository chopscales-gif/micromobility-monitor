"use client";

import dynamic from "next/dynamic";

// The map draws with WebGL, so it only ever runs in the browser.
const ZoneEditor = dynamic(() => import("./ZoneEditor"), {
  ssr: false,
  loading: () => (
    <p data-theme="light" className="grid h-[24rem] place-items-center rounded-xl bg-ink text-dim shadow-[var(--shadow-md)] sm:h-[34rem]">
      Loading the map…
    </p>
  ),
});

export function ZoneEditorLoader(props: { zones: GeoJSON.FeatureCollection; canEdit: boolean; adopt: (formData: FormData) => void | Promise<void> }) {
  return <ZoneEditor {...props} />;
}
