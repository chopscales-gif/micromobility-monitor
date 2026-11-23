// One colour and one plain-English label for each thing the screens talk about.

// `color` is for the page and follows the theme. `hex` is for the maps, which are drawn light in either theme.

export const STATES = {
  available: { label: "Available", hint: "Parked and rentable", color: "var(--color-available)", hex: "#1b9a59" },
  on_trip: { label: "On a trip", hint: "Being ridden now", color: "var(--color-trip)", hex: "#1485b8" },
  non_operational: { label: "Not rentable", hint: "Low battery or out of order, still on the street", color: "var(--color-idle)", hex: "#d18a00" },
  elsewhere: { label: "Outside permitted area", hint: "Ridden out of the service area", color: "var(--color-elsewhere)", hex: "#d42a4f" },
  removed: { label: "Off the street", hint: "Collected by the operator", color: "var(--color-removed)", hex: "#7c8590" },
} as const;

export type StateKey = keyof typeof STATES;
export const STATE_KEYS = Object.keys(STATES) as StateKey[];
export const stateOf = (state: string) => STATES[state as StateKey] ?? { label: state.replaceAll("_", " "), hint: "", color: "var(--color-removed)", hex: "#7a8794" };

/** Each operator has a colour and a shape, so the two never rest on colour alone. */
export const OPERATORS: Record<string, { hex: string; shape: "circle" | "diamond" | "square" }> = {
  kestrel: { hex: "#3567cf", shape: "circle" },
  pronghorn: { hex: "#c8388f", shape: "diamond" },
  saltgrass: { hex: "#84801c", shape: "square" },
};
export const operatorColor = (slug: string) => (slug in OPERATORS ? `var(--color-${slug})` : "var(--color-dim)");
export const operatorHex = (slug: string) => OPERATORS[slug]?.hex ?? "#9aa6b2";

export const TYPES: Record<string, string> = { scooter: "E-scooter", bicycle: "E-bike" };

export const GRADES = {
  good: { label: "Good", color: "var(--color-good)" },
  fair: { label: "Needs attention", color: "var(--color-fair)" },
  poor: { label: "Poor", color: "var(--color-poor)" },
  no_data: { label: "No data", color: "var(--color-removed)" },
} as const;

export const FEED_LABELS: Record<string, string> = {
  "gbfs.gbfs": "GBFS feed index",
  "gbfs.system_information": "GBFS system information",
  "gbfs.vehicle_types": "GBFS vehicle types",
  "gbfs.vehicle_status": "GBFS vehicle status",
  "gbfs.station_information": "GBFS station information",
  "gbfs.station_status": "GBFS station status",
  "gbfs.geofencing_zones": "GBFS geofencing zones",
  "mds.vehicles": "MDS vehicles",
  "mds.vehicles_status": "MDS vehicle status",
  "mds.trips": "MDS trips",
  "mds.telemetry": "MDS telemetry",
  "mds.events_recent": "MDS recent events",
  "mds.events_historical": "MDS historical events",
  "mds.stops": "MDS stops",
  "mds.reports": "MDS monthly report",
};
export const feedLabel = (feed: string) => FEED_LABELS[feed] ?? feed;

export const ZONE_STYLES: Record<string, { label: string; color: string; hex: string }> = {
  service_area: { label: "Permitted service area", color: "var(--color-text)", hex: "#2a1f1a" },
  no_ride: { label: "No riding", color: "var(--color-poor)", hex: "#c8284a" },
  slow_ride: { label: "Slow riding", color: "var(--color-fair)", hex: "#b57a00" },
  no_parking: { label: "No parking", color: "var(--color-zone-no-parking)", hex: "#d0611c" },
  required_parking: { label: "Required parking", color: "var(--color-trip)", hex: "#0b7fb0" },
  equity: { label: "Equity zone", color: "var(--color-zone-equity)", hex: "#0f8f74" },
};

export const hexToRgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
