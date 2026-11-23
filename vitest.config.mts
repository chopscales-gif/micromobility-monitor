import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The console's own "@/..." imports, so its server code can be tested as it is written.
  resolve: { alias: { "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)) } },
  test: { include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"] },
});
