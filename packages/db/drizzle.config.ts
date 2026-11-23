import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://mm:mm@localhost:54329/mm" },
  // PostGIS owns these; drizzle-kit must not try to manage them.
  extensionsFilters: ["postgis"],
});
