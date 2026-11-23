# Vendored open-standard schemas

These files are copied unchanged from the standards bodies' own repositories so that
feed validation runs offline against a pinned, known version.

| Standard | Source | Pinned at | Licence |
|---|---|---|---|
| MDS Provider API (OpenAPI 3.1) | github.com/openmobilityfoundation/mds-openapi, branch `v2.0` | commit `0c07bc3d294237dd41c6273f059efb11b8149c66` | CC BY 4.0 |
| GBFS 3.0 JSON Schemas | github.com/MobilityData/gbfs-json-schema, folder `v3.0` | tag `v4.4.1` | Apache 2.0 |

## Why MDS validation says "2.0 schema with 2.1 patches"

MDS 2.1.0 was published in July 2026, but the Open Mobility Foundation has not yet
published a machine-readable schema for it. The newest official schema is the 2.0
OpenAPI document. The simulated operators publish MDS 2.1, so this project validates
against the official 2.0 schema with a short, explicit list of patches. Each patch is
written down with its reason in `scripts/build-mds-schemas.ts`, and the generated
schemas in `src/schemas/mds/` are rebuilt with `npm run build:schemas -w @mm/core`.

GBFS 3.1 was published in November 2026 and its JSON Schemas are not out yet either.
The simulated operators publish GBFS 3.0, validated against the unmodified 3.0 schemas.
