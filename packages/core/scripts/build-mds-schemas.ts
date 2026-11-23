// Turns the vendored MDS OpenAPI document (many YAML files) into one standalone
// JSON Schema per Provider endpoint, applying the patches listed below.
//
// Run: npm run build:schemas -w @mm/core

import $RefParser from "@apidevtools/json-schema-ref-parser";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "src/schemas/mds");

type Schema = Record<string, any>;

/** Endpoints we ingest, and the schema file each one becomes. */
const ENDPOINTS: Record<string, string> = {
  "/vehicles": "vehicles",
  "/vehicles/status": "vehicles_status",
  "/trips": "trips",
  "/telemetry": "telemetry",
  "/events/historical": "events_historical",
  "/events/recent": "events_recent",
  "/stops": "stops",
};

function walk(node: unknown, visit: (n: Schema) => void, seen = new Set<unknown>()): void {
  if (!node || typeof node !== "object" || seen.has(node)) return;
  seen.add(node);
  if (!Array.isArray(node)) visit(node as Schema);
  for (const value of Object.values(node as object)) walk(value, visit, seen);
}

// --- Patches -----------------------------------------------------------------
// Every departure from the official 2.0 schema is listed here, with the reason.
export const PATCHES = [
  {
    id: "pin-micromobility-mode",
    reason:
      "The schema accepts an event, trip or vehicle if it matches exactly one of four modes (car share, delivery robots, micromobility, passenger services). A valid scooter record can match more than one, which fails it. This city regulates micromobility only, so the micromobility rules are applied directly.",
    apply(schema: Schema) {
      walk(schema, (n) => {
        if (!Array.isArray(n.oneOf)) return;
        const micromobility = n.oneOf.find((o: Schema) => typeof o?.title === "string" && o.title.startsWith("modes/micromobility"));
        // (The car share trip file is titled "modes/care-share", so match any other mode.)
        if (micromobility && n.oneOf.every((o: Schema) => typeof o?.title === "string" && o.title.startsWith("modes/"))) {
          delete n.oneOf;
          n.allOf = [...(n.allOf ?? []), micromobility];
        }
      });
    },
  },
  {
    id: "fix-trip-id-condition",
    reason:
      "The rule 'trip events must carry a trip id' is written with a list under `contains`, which is not valid JSON Schema and never takes effect. Rewritten so it does what the MDS text says (modes/micromobility.md, Trip ID Requirements).",
    apply(schema: Schema) {
      walk(schema, (n) => {
        const contains = n.if?.properties?.event_types?.contains;
        if (Array.isArray(contains)) {
          n.if = { properties: { event_types: { contains: { enum: contains } } }, required: ["event_types"] };
          n.then = { required: ["trip_ids"], properties: { trip_ids: { minItems: 1 } } };
        }
      });
    },
  },
  {
    id: "vehicle-types-2.1",
    reason: "MDS 2.1 adds the vehicle types scooter, van and freight (data-types.md).",
    apply(schema: Schema) {
      walk(schema, (n) => {
        if (n.title === "data-types/vehicle-type" && Array.isArray(n.enum)) {
          for (const v of ["scooter", "van", "freight"]) if (!n.enum.includes(v)) n.enum.push(v);
        }
      });
    },
  },
  {
    id: "parking-categories-2.1",
    reason: "MDS 2.1 adds the parking categories space and dock (data-types.md, Trips).",
    apply(schema: Schema) {
      walk(schema, (n) => {
        const e = n.properties?.parking_category?.enum;
        if (Array.isArray(e)) for (const v of ["space", "dock"]) if (!e.includes(v)) e.push(v);
      });
    },
  },
] as const;

const api = (await $RefParser.dereference(path.join(root, "vendor/mds-openapi/reference/provider.yaml"), {
  dereference: { circular: "ignore" },
})) as Schema;

mkdirSync(out, { recursive: true });
for (const [route, name] of Object.entries(ENDPOINTS)) {
  const schema = structuredClone(api.paths[route].get.responses["200"].content["application/json"].schema);
  for (const patch of PATCHES) patch.apply(schema);
  // Editor-only metadata is dropped; it is not part of the contract.
  walk(schema, (n) => {
    delete n["x-stoplight"];
    delete n.examples;
  });
  schema.$schema = "https://json-schema.org/draft/2020-12/schema";
  schema.$comment = `Generated from mds-openapi@0c07bc3 (${route}) with patches: ${PATCHES.map((p) => p.id).join(", ")}. Do not edit.`;
  writeFileSync(path.join(out, `${name}.json`), JSON.stringify(schema));
  console.log(`${route} -> src/schemas/mds/${name}.json`);
}
writeFileSync(
  path.join(out, "patches.json"),
  JSON.stringify(PATCHES.map(({ id, reason }) => ({ id, reason })), null, 2) + "\n",
);
