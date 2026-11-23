import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const sql = postgres(url, { max: 1, onnotice: () => {} });
await sql`create extension if not exists postgis`;
await migrate(drizzle(sql), { migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url)) });
await sql.end();
console.log("Database is up to date.");
