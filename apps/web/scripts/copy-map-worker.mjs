// MapLibre runs its tile parsing in a web worker loaded from a URL of its own.
// A bundler cannot follow that, so the worker file is copied into public/ and served as is.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const from = resolve(dirname(require.resolve("maplibre-gl/package.json")), "dist/maplibre-gl-worker.mjs");
const to = resolve(import.meta.dirname, "../public/vendor/maplibre-gl-worker.mjs");
mkdirSync(dirname(to), { recursive: true });
copyFileSync(from, to);
