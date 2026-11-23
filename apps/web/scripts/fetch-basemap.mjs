// Copies the map tiles for Salt Lake City out of a Protomaps daily build (OpenStreetMap data)
// into public/basemap, so the demo serves its own basemap and calls no map service.
//
//   node apps/web/scripts/fetch-basemap.mjs [build-date, e.g. 20261101]
//
// Covers the city and its near surroundings from zoom 9 to zoom 15 (every street and building).
// The map in the app is limited to the same bounds (src/components/map/basemap.ts).

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PMTiles } from "pmtiles";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "../public/basemap");
const BOUNDS = [-112.0, 40.7, -111.77, 40.82];

const tileX = (lng, z) => Math.floor(((lng + 180) / 360) * 2 ** z);
const tileY = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

let build = process.argv[2];
if (!build) {
  const builds = await (await fetch("https://build-metadata.protomaps.dev/builds.json")).json();
  build = builds.at(-1).key.replace(".pmtiles", "");
}
const archive = new PMTiles(`https://build.protomaps.com/${build}.pmtiles`);

let count = 0;
let bytes = 0;
for (let z = 9; z <= 15; z++) {
  const [w, s, e, n] = BOUNDS;
  for (let x = tileX(w, z); x <= tileX(e, z); x++) {
    for (let y = tileY(n, z); y <= tileY(s, z); y++) {
      const tile = await archive.getZxy(z, x, y);
      if (!tile) continue;
      const file = join(OUT, String(z), String(x), `${y}.mvt`);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, Buffer.from(tile.data));
      count++;
      bytes += tile.data.byteLength;
    }
  }
}
await writeFile(join(OUT, "SOURCE.txt"), `Protomaps basemap build ${build} (https://protomaps.com), map data (c) OpenStreetMap contributors, ODbL.\nBounds ${BOUNDS.join(", ")}, zoom 9 to 15.\n`);
console.log(`Build ${build}: ${count} tiles, ${(bytes / 1e6).toFixed(1)} MB`);
