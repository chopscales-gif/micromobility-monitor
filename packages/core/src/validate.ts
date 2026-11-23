// Feed validation against the official GBFS and MDS schemas.
//
// A feed response is checked in two parts: the envelope (version, timestamps,
// paging) and then each record on its own. One malformed scooter record must
// not throw away the other 799 in the payload, and the city needs a count of
// exactly how many records an operator got wrong.

import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import gbfsDiscovery from "../vendor/gbfs-json-schema/v3.0/gbfs.json";
import gbfsGeofencingZones from "../vendor/gbfs-json-schema/v3.0/geofencing_zones.json";
import gbfsStationInformation from "../vendor/gbfs-json-schema/v3.0/station_information.json";
import gbfsStationStatus from "../vendor/gbfs-json-schema/v3.0/station_status.json";
import gbfsSystemInformation from "../vendor/gbfs-json-schema/v3.0/system_information.json";
import gbfsVehicleStatus from "../vendor/gbfs-json-schema/v3.0/vehicle_status.json";
import gbfsVehicleTypes from "../vendor/gbfs-json-schema/v3.0/vehicle_types.json";
import mdsEventsHistorical from "./schemas/mds/events_historical.json";
import mdsEventsRecent from "./schemas/mds/events_recent.json";
import mdsStops from "./schemas/mds/stops.json";
import mdsTelemetry from "./schemas/mds/telemetry.json";
import mdsTrips from "./schemas/mds/trips.json";
import mdsVehicles from "./schemas/mds/vehicles.json";
import mdsVehiclesStatus from "./schemas/mds/vehicles_status.json";

type Schema = Record<string, any>;

type FeedSpec = {
  standard: "GBFS" | "MDS";
  /** What the feed is checked against, as shown to staff. */
  checkedAgainst: string;
  schema: Schema;
  /** Path from the response root to the array of records, if the feed has one. */
  records: string[] | null;
  /** Field that identifies a record in error reports. */
  idField: string | null;
};

const GBFS = "GBFS 3.0 official schema";
const MDS = "MDS 2.0 official schema with 2.1 patches";

export const FEEDS = {
  "gbfs.gbfs": { standard: "GBFS", checkedAgainst: GBFS, schema: gbfsDiscovery, records: null, idField: null },
  "gbfs.system_information": { standard: "GBFS", checkedAgainst: GBFS, schema: gbfsSystemInformation, records: null, idField: null },
  "gbfs.vehicle_types": { standard: "GBFS", checkedAgainst: GBFS, schema: gbfsVehicleTypes, records: ["data", "vehicle_types"], idField: "vehicle_type_id" },
  "gbfs.vehicle_status": { standard: "GBFS", checkedAgainst: GBFS, schema: gbfsVehicleStatus, records: ["data", "vehicles"], idField: "vehicle_id" },
  "gbfs.station_information": { standard: "GBFS", checkedAgainst: GBFS, schema: gbfsStationInformation, records: ["data", "stations"], idField: "station_id" },
  "gbfs.station_status": { standard: "GBFS", checkedAgainst: GBFS, schema: gbfsStationStatus, records: ["data", "stations"], idField: "station_id" },
  "gbfs.geofencing_zones": { standard: "GBFS", checkedAgainst: GBFS, schema: gbfsGeofencingZones, records: ["data", "geofencing_zones", "features"], idField: null },
  "mds.vehicles": { standard: "MDS", checkedAgainst: MDS, schema: mdsVehicles, records: ["vehicles"], idField: "device_id" },
  "mds.vehicles_status": { standard: "MDS", checkedAgainst: MDS, schema: mdsVehiclesStatus, records: ["vehicles_status"], idField: "device_id" },
  "mds.trips": { standard: "MDS", checkedAgainst: MDS, schema: mdsTrips, records: ["trips"], idField: "trip_id" },
  "mds.telemetry": { standard: "MDS", checkedAgainst: MDS, schema: mdsTelemetry, records: ["telemetry"], idField: "telemetry_id" },
  "mds.events_recent": { standard: "MDS", checkedAgainst: MDS, schema: mdsEventsRecent, records: ["events"], idField: "event_id" },
  "mds.events_historical": { standard: "MDS", checkedAgainst: MDS, schema: mdsEventsHistorical, records: ["events"], idField: "event_id" },
  "mds.stops": { standard: "MDS", checkedAgainst: MDS, schema: mdsStops, records: ["stops"], idField: "stop_id" },
} satisfies Record<string, FeedSpec>;

export type FeedId = keyof typeof FEEDS;
export const FEED_IDS = Object.keys(FEEDS) as FeedId[];

export type Issue = {
  /** JSON pointer to the offending value, relative to the record (or the response). */
  path: string;
  keyword: string;
  message: string;
};

export type InvalidRecord = { index: number; recordId: string | null; issues: Issue[]; record: unknown };

export type FeedValidation<T = unknown> = {
  feed: FeedId;
  checkedAgainst: string;
  /** Problems with the response as a whole. If any exist, no records are trusted. */
  envelopeIssues: Issue[];
  recordCount: number;
  validRecords: T[];
  invalidRecords: InvalidRecord[];
};

// --- Schema handling ---------------------------------------------------------

/** Locates the `items` schema for a record array, looking through `allOf` branches. */
function findArraySchema(schema: Schema, path: string[]): Schema | null {
  if (path.length === 0) return schema.type === "array" || schema.items ? schema : null;
  const [head, ...rest] = path as [string, ...string[]];
  const direct = schema.properties?.[head];
  if (direct) {
    const found = findArraySchema(direct, rest);
    if (found) return found;
  }
  for (const branch of schema.allOf ?? []) {
    const found = findArraySchema(branch, path);
    if (found) return found;
  }
  return null;
}

type Compiled = { envelope: ValidateFunction; record: ValidateFunction | null };
const compiled = new Map<FeedId, Compiled>();

function ajvFor(standard: "GBFS" | "MDS") {
  // GBFS schemas are JSON Schema draft-07; MDS OpenAPI 3.1 uses draft 2020-12.
  // strict is off because both carry annotation keywords Ajv does not know.
  const ajv = standard === "MDS" ? new Ajv2020({ allErrors: true, strict: false }) : new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv;
}

function compile(feed: FeedId): Compiled {
  let entry = compiled.get(feed);
  if (entry) return entry;
  const spec: FeedSpec = FEEDS[feed];
  const ajv = ajvFor(spec.standard);
  const envelopeSchema = structuredClone(spec.schema);
  delete envelopeSchema.$id;
  let record: ValidateFunction | null = null;
  if (spec.records) {
    const array = findArraySchema(envelopeSchema, spec.records);
    if (!array?.items) throw new Error(`No record schema found for ${feed}`);
    record = ajv.compile(array.items);
    array.items = {}; // records are checked one by one, below
  }
  entry = { envelope: ajv.compile(envelopeSchema), record };
  compiled.set(feed, entry);
  return entry;
}

// Ajv reports every branch it tried. These keywords name the actual fault;
// the rest are wrappers ("must match exactly one schema") that add nothing.
const SPECIFIC = ["required", "type", "enum", "format", "pattern", "minimum", "maximum", "minItems", "additionalProperties"];

function toIssues(errors: ErrorObject[] | null | undefined, data: unknown): Issue[] {
  if (!errors?.length) return [];
  const specific = errors.filter((e) => SPECIFIC.includes(e.keyword));
  const chosen = specific.length ? specific : errors;
  const seen = new Set<string>();
  const issues: Issue[] = [];
  for (const e of chosen) {
    let path = e.instancePath;
    let message = e.message ?? "is invalid";
    if (e.keyword === "required") {
      path = `${path}/${e.params.missingProperty}`;
      message = "is required but missing";
    } else if (e.keyword === "enum" || e.keyword === "type" || e.keyword === "format") {
      const value = path.split("/").slice(1).reduce<any>((v, k) => v?.[k], data);
      if (value !== undefined && typeof value !== "object") message += ` (got ${JSON.stringify(value)})`;
    }
    const key = `${path}|${e.keyword}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push({ path: path || "/", keyword: e.keyword, message });
  }
  return issues.slice(0, 5);
}

export function validateFeed<T = unknown>(feed: FeedId, body: unknown): FeedValidation<T> {
  const spec: FeedSpec = FEEDS[feed];
  const { envelope, record } = compile(feed);
  const result: FeedValidation<T> = {
    feed,
    checkedAgainst: spec.checkedAgainst,
    envelopeIssues: [],
    recordCount: 0,
    validRecords: [],
    invalidRecords: [],
  };

  if (!envelope(body)) {
    result.envelopeIssues = toIssues(envelope.errors, body);
    return result;
  }
  if (!spec.records || !record) return result;

  const records = spec.records.reduce<any>((value, key) => value?.[key], body) as unknown[];
  result.recordCount = records.length;
  records.forEach((item, index) => {
    if (record(item)) {
      result.validRecords.push(item as T);
    } else {
      const id = spec.idField ? (item as any)?.[spec.idField] : null;
      result.invalidRecords.push({
        index,
        recordId: typeof id === "string" ? id : null,
        issues: toIssues(record.errors, item),
        record: item,
      });
    }
  });
  return result;
}
