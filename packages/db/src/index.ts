// Queries are written in SQL through postgres.js. Drizzle describes the schema
// (schema.ts) and generates the migrations; it is not in the query path.

import postgres from "postgres";

export * as schema from "./schema";
export * from "./crypto";

export type Sql = ReturnType<typeof postgres>;

/**
 * How the connection to the database is encrypted, from DATABASE_SSL: "require" encrypts it,
 * "verify-full" also checks the server's certificate. Unset, it is left to DATABASE_URL, which is
 * right for a database on the same machine or private network and wrong for anything else.
 */
export function sslMode(value = process.env.DATABASE_SSL): "require" | "verify-full" | undefined {
  if (!value) return undefined;
  if (value === "require" || value === "verify-full") return value;
  throw new Error('DATABASE_SSL must be "require" or "verify-full"');
}

export function connect(url = process.env.DATABASE_URL, options: { max?: number } = {}): { sql: Sql } {
  if (!url) throw new Error("DATABASE_URL is not set");
  const ssl = sslMode();
  return { sql: postgres(url, { max: options.max ?? 5, onnotice: () => {}, ...(ssl ? { ssl } : {}) }) };
}
