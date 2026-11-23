import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { NextConfig } from "next";

// One .env at the repository root serves every app.
const rootEnv = resolve(import.meta.dirname, "../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const config: NextConfig = {
  // The workspace packages are plain TypeScript sources.
  transpilePackages: ["@mm/core", "@mm/db", "@mm/ingest"],
  // Keep the development badge off the theme toggle in the sidebar.
  devIndicators: { position: "bottom-right" },
  serverExternalPackages: ["postgres", "@react-pdf/renderer"],
  // A stopped demonstration clock has to read the same in the browser as on the server.
  env: { DEMO_CLOCK: process.env.DEMO_CLOCK ?? "" },
  async headers() {
    return [
      { source: "/basemap/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=604800, immutable" }] },
      // Every response: HTTPS only once seen over HTTPS, no framing by another site, no guessing at content types,
      // and no full address sent on to other sites. A content security policy is not set; see the security document.
      {
        source: "/:path*",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default config;
