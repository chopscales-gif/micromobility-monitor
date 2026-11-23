// The simulated city: downtown Salt Lake City's street grid, the places people
// ride between, the city's zones, and three fictional operators.
//
// Streets are real (the grid is laid out from Main St & South Temple, one block
// every 792 ft). Zone boundaries are ILLUSTRATIVE. They are drawn for this demo
// and are not Salt Lake City policy.

import type { LngLat, Polygon } from "@mm/core/geo";

// --- Street grid ------------------------------------------------------------
// Grid coordinates: x = blocks east of Main St, y = blocks south of South Temple.
const ORIGIN: LngLat = [-111.89105, 40.76945];
const BLOCK_LNG = 0.002862;
const BLOCK_LAT = 0.002175;
export const BLOCK_METERS = 241.4;

export type GridPoint = { x: number; y: number };

export function toLngLat(p: GridPoint): LngLat {
  return [ORIGIN[0] + p.x * BLOCK_LNG, ORIGIN[1] - p.y * BLOCK_LAT];
}

function rect(x0: number, y0: number, x1: number, y1: number): Polygon {
  const corners: GridPoint[] = [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
    { x: x0, y: y0 },
  ];
  return [corners.map(toLngLat)];
}

// --- Zones ------------------------------------------------------------------
export type ZoneType = "service_area" | "no_ride" | "slow_ride" | "no_parking" | "required_parking" | "equity";

export type Zone = {
  slug: string;
  name: string;
  type: ZoneType;
  /** Grid-space bounds, kept so the simulator can test membership cheaply. */
  bounds: { x0: number; y0: number; x1: number; y1: number };
  polygon: Polygon;
  /** Speed limit inside a slow-ride zone. */
  speedLimitKph?: number;
};

function zone(slug: string, name: string, type: ZoneType, x0: number, y0: number, x1: number, y1: number, extra: Partial<Zone> = {}): Zone {
  return { slug, name, type, bounds: { x0, y0, x1, y1 }, polygon: rect(x0, y0, x1, y1), ...extra };
}

export const SERVICE_AREA = zone("service-area", "Permitted service area", "service_area", -12, -5, 19, 14);

export const ZONES: Zone[] = [
  SERVICE_AREA,
  zone("temple-square", "Temple Square (no riding)", "no_ride", -1, -1, 0, 0),
  zone("main-street-slow", "Main Street pedestrian corridor", "slow_ride", -0.18, 0, 0.18, 4, { speedLimitKph: 13 }),
  zone("campus-core-slow", "University campus core", "slow_ride", 13.6, 1.4, 16.2, 4, { speedLimitKph: 13 }),
  zone("library-square", "Library Square plaza", "no_parking", 2.08, 4.08, 2.92, 4.92),
  zone("gallivan-plaza", "Gallivan Center plaza", "no_parking", 0.1, 2.1, 0.9, 2.9),
  zone("central-station-platforms", "Salt Lake Central platforms", "no_parking", -6.6, 2.1, -6.05, 3.4),
  zone("west-side-equity", "West side equity zone", "equity", -12, -3, -7, 6),
  zone("glendale-equity", "Glendale equity zone", "equity", -12, 6, -7.5, 12),
];

export function inZone(p: GridPoint, z: Zone): boolean {
  return p.x >= z.bounds.x0 && p.x <= z.bounds.x1 && p.y >= z.bounds.y0 && p.y <= z.bounds.y1;
}

export const zonesOfType = (type: ZoneType) => ZONES.filter((z) => z.type === type);

// --- Places people ride between --------------------------------------------
export type Hotspot = {
  name: string;
  at: GridPoint;
  /** How strongly this place generates trips of each kind (0 to 1). */
  home: number;
  work: number;
  leisure: number;
  campus: number;
  /** Spread of pick-up and drop-off points around the centre, in blocks. */
  spread: number;
};

const spot = (name: string, x: number, y: number, home: number, work: number, leisure: number, campus = 0, spread = 0.8): Hotspot => ({
  name, at: { x, y }, home, work, leisure, campus, spread,
});

export const HOTSPOTS: Hotspot[] = [
  spot("City Creek", 0, 0.8, 0.1, 1, 0.8),
  spot("Temple Square", -0.5, -0.4, 0, 0.2, 0.7, 0, 0.5),
  spot("Gallivan Center", 0.4, 2.5, 0.1, 1, 0.6),
  spot("Courthouse", 1, 4.2, 0.1, 0.8, 0.2),
  spot("Library Square", 2.5, 4.5, 0.1, 0.5, 0.7, 0.1),
  spot("Salt Lake Central", -6.2, 2.7, 0.1, 0.7, 0.2, 0, 0.5),
  spot("The Gateway", -4, 0.6, 0.3, 0.4, 0.9),
  spot("Arena", -3, 0.5, 0, 0.2, 0.9, 0, 0.6),
  spot("Pioneer Park", -3, 3.5, 0.3, 0.3, 0.6),
  spot("Central Ninth", -1.5, 9, 0.8, 0.2, 0.5),
  spot("Granary District", -4, 7.5, 0.6, 0.3, 0.6),
  spot("Trolley Square", 6.5, 5.6, 0.5, 0.2, 0.8),
  spot("9th and 9th", 9, 9, 0.8, 0.1, 0.8),
  spot("Liberty Park", 6, 9.6, 0.3, 0, 1, 0, 1),
  spot("Central City", 4, 3, 1, 0.2, 0.3, 0.2, 1.2),
  spot("East Central", 9.5, 3, 1, 0.1, 0.3, 0.7, 1.4),
  spot("Lower Avenues", 4, -2, 0.9, 0.1, 0.2, 0.2, 1.4),
  spot("Capitol Hill", -0.6, -3, 0.5, 0.3, 0.3, 0, 0.8),
  spot("Ballpark", -0.5, 12.5, 0.7, 0.1, 0.5, 0, 1),
  spot("President's Circle", 13.2, 2.6, 0.1, 0.3, 0.1, 1, 0.6),
  spot("Marriott Library", 15.4, 3, 0, 0.2, 0.1, 1, 0.7),
  spot("Stadium", 13, 5, 0.3, 0.1, 0.4, 0.8, 0.7),
  spot("University Hospital", 17.6, 1.6, 0, 0.7, 0, 0.5, 0.6),
  spot("North Temple", -8, 0.1, 0.7, 0.2, 0.2, 0, 1),
  spot("Fairpark", -9.2, -1.2, 0.8, 0.1, 0.3, 0, 1.2),
  spot("Poplar Grove", -9.6, 4, 0.9, 0.1, 0.2, 0, 1.4),
  spot("Glendale", -10, 9, 0.8, 0.1, 0.2, 0, 1.4),
];

/** Where riders who leave the permitted area end up. */
export const OUT_OF_AREA_DESTINATIONS: GridPoint[] = [
  { x: 20.6, y: 3.2 }, // foothills above the university
  { x: 3, y: 15.6 }, // south of 1300 South
  { x: -13.4, y: 2 }, // west of Redwood Road
];

// --- Operators (fictional) --------------------------------------------------
export type VehicleKind = "scooter" | "bicycle";

export type OperatorProfile = {
  slug: string;
  name: string;
  /** Bearer token the operator's MDS Provider API expects. Demo value, not a secret. */
  token: string;
  scooters: number;
  bikes: number;
  /** Docked operators park e-bikes at stations. */
  stations: number;
  /** Devices the city has permitted. Deploying more than this breaks the fleet cap. */
  permittedDevices: number;
  behaviour: {
    /** Share of rides that end inside a no-parking zone when one is nearby. */
    badParking: number;
    /** Share of rides that end outside the permitted area. */
    leavesArea: number;
    /** Whether vehicles slow themselves down inside slow-ride zones. */
    governsSlowZones: boolean;
    /** Share of the morning fleet placed in equity zones. */
    equityShare: number;
    /** Whether the midday crew moves idle vehicles into equity zones. */
    rebalancesToEquity: boolean;
    /** Extra devices put out on Fridays and Saturdays, over the permit. */
    weekendOverDeploy: number;
    /** Share of vehicles that get left in one spot for days. */
    neglect: number;
    /** Share of real trips the operator leaves out of its own monthly report. */
    underReport: number;
  };
  /** Faults in the data feeds themselves (see faults.ts). */
  feedQuality: "clean" | "minor" | "poor";
};

export const OPERATORS: OperatorProfile[] = [
  {
    slug: "kestrel",
    name: "Kestrel Mobility",
    token: "demo-token-kestrel",
    scooters: 700,
    bikes: 120,
    stations: 0,
    permittedDevices: 850,
    behaviour: {
      badParking: 0.01, leavesArea: 0.002, governsSlowZones: true, equityShare: 0.17,
      rebalancesToEquity: true, weekendOverDeploy: 0, neglect: 0.004, underReport: 0,
    },
    feedQuality: "clean",
  },
  {
    slug: "pronghorn",
    name: "Pronghorn Rides",
    token: "demo-token-pronghorn",
    scooters: 600,
    bikes: 0,
    stations: 0,
    permittedDevices: 550,
    behaviour: {
      badParking: 0.09, leavesArea: 0.008, governsSlowZones: false, equityShare: 0.05,
      rebalancesToEquity: false, weekendOverDeploy: 45, neglect: 0.03, underReport: 0.031,
    },
    feedQuality: "minor",
  },
  {
    slug: "saltgrass",
    name: "Saltgrass Bikeshare",
    token: "demo-token-saltgrass",
    scooters: 200,
    bikes: 180,
    stations: 20,
    permittedDevices: 400,
    behaviour: {
      badParking: 0.03, leavesArea: 0.003, governsSlowZones: true, equityShare: 0.12,
      rebalancesToEquity: true, weekendOverDeploy: 0, neglect: 0.01, underReport: 0.004,
    },
    feedQuality: "poor",
  },
];

export const operatorBySlug = (slug: string) => OPERATORS.find((o) => o.slug === slug);
